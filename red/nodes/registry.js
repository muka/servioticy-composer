/**
 * Original work Copyright 2013, 2014 IBM Corp.
 * Modified work Copyright 2014 Barcelona Supercomputing Center (BSC)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

var util = require("util");
var when = require("when");
var whenNode = require('when/node');
var fs = require("fs");
var path = require("path");
var crypto = require("crypto"); 
var cheerio = require("cheerio");
var UglifyJS = require("uglify-js");

var events = require("../events");

var settings;

function filterNodeInfo(n) {
    var r = {
        id: n.id,
        types: n.types,
        name: n.name,
        enabled: n.enabled
    }
    if (n.err) {
        r.err = n.err.toString();
    }
    return r;
}

var registry = (function() {
    var nodeConfigCache = null;
    var nodeConfigs = {};
    var nodeList = [];
    var nodeTypeToId = {};
    
    return {
        addNodeSet: function(id,set) {
            if (!set.err) {
                set.types.forEach(function(t) {
                    nodeTypeToId[t] = id;
                });
            }
            nodeConfigs[id] = set;
            nodeList.push(id);
            nodeConfigCache = null;
        },
        removeNode: function(id) {
            var config = nodeConfigs[id];
            if (!config) {
                throw new Error("Unrecognised id: "+id);
            }
            delete nodeConfigs[id];
            var i = nodeList.indexOf(id);
            if (i > -1) {
                nodeList.splice(i,1);
            }
            config.types.forEach(function(t) {
                delete nodeTypeToId[t];
            });
            nodeConfigCache = null;
            return filterNodeInfo(config);
        },
        getNodeInfo: function(typeOrId) {
            if (nodeTypeToId[typeOrId]) {
                return filterNodeInfo(nodeConfigs[nodeTypeToId[typeOrId]]);
            } else if (nodeConfigs[typeOrId]) {
                return filterNodeInfo(nodeConfigs[typeOrId]);
            }
            return null;
        },
        getNodeList: function() {
            return nodeList.map(function(id) {
                var n = nodeConfigs[id];
                return filterNodeInfo(n);
            });
        },
        /**
         * Gets all of the node template configs
         * @return all of the node templates in a single string
         */
        getAllNodeConfigs: function() {
            if (!nodeConfigCache) {
                var result = "";
                var script = "";
                for (var i=0;i<nodeList.length;i++) {
                    var config = nodeConfigs[nodeList[i]];
                    if (config.enabled) {
                        result += config.config;
                        script += config.script;
                    }
                }
                if (script.length > 0) {
                    result += '<script type="text/javascript">';
                    result += UglifyJS.minify(script, {fromString: true}).code;
                    result += '</script>';
                }
                nodeConfigCache = result;
            }
            return nodeConfigCache;
        },
        
        getNodeConfig: function(id) {
            var config = nodeConfigs[id];
            if (config) {
                var result = config.config;
                result += '<script type="text/javascript">'+config.script+'</script>';
                return result;
            } else {
                return null;
            }
        },

        getNodeConstructor: function(type) {
            var config = nodeConfigs[nodeTypeToId[type]];
            if (!config || config.enabled) {
                return nodeConstructors[type];
            }
            return null;
        },
        
        clear: function() {
            nodeConfigCache = null;
            nodeConfigs = {};
            nodeList = [];
            nodeTypeToId = {};
        },
        
        getTypeId: function(type) {
            return nodeTypeToId[type];
        },
        
        enableNodeSet: function(id) {
            var config = nodeConfigs[id];
            if (config) {
                if (config.err) {
                    throw new Error("cannot enable node with error");
                }
                config.enabled = true;
                nodeConfigCache = null;
            }
        },
        
        disableNodeSet: function(id) {
            var config = nodeConfigs[id];
            if (config) {
                config.enabled = false;
                nodeConfigCache = null;
            }
            
        }
    }
})();



function init(_settings) {
    settings = _settings;
}

/**
 * Synchronously walks the directory looking for node files.
 * Emits 'node-icon-dir' events for an icon dirs found
 * @param dir the directory to search
 * @return an array of fully-qualified paths to .js files
 */
function getNodeFiles(dir) {
    var result = [];
    var files = [];
    try {
        files = fs.readdirSync(dir);
    } catch(err) {
        return result;
    }
    files.sort();
    files.forEach(function(fn) {
        var stats = fs.statSync(path.join(dir,fn));
        if (stats.isFile()) {
            if (/\.html$/.test(fn)) {
                var valid = true;
                if (settings.nodesExcludes) {
                    for (var i=0;i<settings.nodesExcludes.length;i++) {
                        if (settings.nodesExcludes[i] == fn) {
                            valid = false;
                            break;
                        }
                    }
                }
                if (valid) {
                    result.push(path.join(dir,fn));
                }
            }
        } else if (stats.isDirectory()) {
            // Ignore /.dirs/, /lib/ /node_modules/ 
            if (!/^(\..*|lib|icons|node_modules|test)$/.test(fn)) {
                result = result.concat(getNodeFiles(path.join(dir,fn)));
            } else if (fn === "icons") {
                events.emit("node-icon-dir",path.join(dir,fn));
            }
        }
    });
    return result;
}

/**
 * Scans the node_modules path for nodes
 * @param moduleName the name of the module to be found
 * @return a list of node modules: {dir,package}
 */
function scanTreeForNodesModules(moduleName) {
    var dir = __dirname+"/../../nodes";
    var results = [];
    var up = path.resolve(path.join(dir,".."));
    while (up !== dir) {
        var pm = path.join(dir,"node_modules");
        try {
            var files = fs.readdirSync(pm);
            files.forEach(function(fn) {
                if (!moduleName || fn == moduleName) {
                    var pkgfn = path.join(pm,fn,"package.json");
                    try {
                        var pkg = require(pkgfn);
                        if (pkg['node-red']) {
                            var moduleDir = path.join(pm,fn);
                            results.push({dir:moduleDir,package:pkg});
                        }
                    } catch(err) {
                        if (err.code != "MODULE_NOT_FOUND") {
                            // TODO: handle unexpected error
                        }
                    }
                }
            });
        } catch(err) {
        }
        
        dir = up;
        up = path.resolve(path.join(dir,".."));
    }
    return results;
}

/**
 * Loads the nodes provided in an npm package.
 * @param moduleDir the root directory of the package
 * @param pkg the module's package.json object
 */
function loadNodesFromModule(moduleDir,pkg) {
    var nodes = pkg['node-red'].nodes||{};
    var results = [];
    var iconDirs = [];
    for (var n in nodes) {
        if (nodes.hasOwnProperty(n)) {
            var file = path.join(moduleDir,nodes[n]);
            results.push(loadNodeConfig(file,pkg.name,n));
            var iconDir = path.join(moduleDir,path.dirname(nodes[n]),"icons");
            if (iconDirs.indexOf(iconDir) == -1) {
                if (fs.existsSync(iconDir)) {
                    events.emit("node-icon-dir",iconDir);
                    iconDirs.push(iconDir);
                }
            }
        }
    }
    return results;
}


/**
 * Loads a node's configuration
 * @param file the fully qualified path of the node's .js file
 * @param name the name of the node
 * @return the node object
 *         {
 *            id: a unqiue id for the node file
 *            name: the name of the node file, or label from the npm module
 *            file: the fully qualified path to the node's .js file
 *            template: the fully qualified path to the node's .html file
 *            config: the non-script parts of the node's .html file
 *            script: the script part of the node's .html file
 *            types: an array of node type names in this file
 *         }
 */
function loadNodeConfig(file,module,name) {
    var id = crypto.createHash('sha1').update(file).digest("hex");

    if (registry.getNodeInfo(id)) {
        throw new Error(file+" already loaded");
    }
    
    var node = {
        id: id,
        template: file,
        enabled: true
    }
    
    if (module) {
        node.name = module+":"+name;
        node.module = module;
    } else {
        node.name = path.basename(file)
    }

    
    var content = fs.readFileSync(node.template,'utf8');
    
    var $ = cheerio.load(content);
    var template = "";
    var script = "";
    var types = [];
    
    $("*").each(function(i,el) {
        if (el.type == "script" && el.attribs.type == "text/javascript") {
            script += el.children[0].data;
        } else if (el.name == "script" || el.name == "style") {
            if (el.attribs.type == "text/x-red" && el.attribs['data-template-name']) {
                types.push(el.attribs['data-template-name'])
            }
            var openTag = "<"+el.name;
            var closeTag = "</"+el.name+">";
            for (var j in el.attribs) {
                if (el.attribs.hasOwnProperty(j)) {
                    openTag += " "+j+'="'+el.attribs[j]+'"';
                }
            }
            openTag += ">";
            template += openTag+$(el).text()+closeTag;
        }
    });
    node.types = types;
    node.config = template;
    node.script = script;
    
    for (var i=0;i<node.types.length;i++) {
        if (registry.getTypeId(node.types[i])) {
            node.err = node.types[i]+" already registered";
            break;
        }
    }
    registry.addNodeSet(id,node);
    return node;
}

/**
 * Loads all palette nodes
 * @param defaultNodesDir optional parameter, when set, it overrides the default
 *                        location of nodeFiles - used by the tests
 * @return a promise that resolves on completion of loading
 */
function load(defaultNodesDir,disableNodePathScan) {
    return when.promise(function(resolve,reject) {
        // Find all of the nodes to load
        var nodeFiles;
        if(defaultNodesDir) {
            nodeFiles = getNodeFiles(path.resolve(defaultNodesDir));
        } else {
            nodeFiles = getNodeFiles(__dirname+"/../../nodes");
        }
        
        if (settings.nodesDir) {
            var dir = settings.nodesDir;
            if (typeof settings.nodesDir == "string") {
                dir = [dir];
            }
            for (var i=0;i<dir.length;i++) {
                nodeFiles = nodeFiles.concat(getNodeFiles(dir[i]));
            }
        }
        var nodes = [];
        nodeFiles.forEach(function(file) {
            try {
                nodes.push(loadNodeConfig(file));
            } catch(err) {
                // 
            }
        });
        
        // TODO: disabling npm module loading if defaultNodesDir set
        //       This indicates a test is being run - don't want to pick up
        //       unexpected nodes.
        //       Urgh.
        if (!disableNodePathScan) {
            // Find all of the modules containing nodes
            var moduleFiles = scanTreeForNodesModules();
            moduleFiles.forEach(function(moduleFile) {
                nodes = nodes.concat(loadNodesFromModule(moduleFile.dir,moduleFile.package));
            });
        }
        registry.getAllNodeConfigs();
        resolve();
    });
}

module.exports = {
    init:init,
    load:load,
    clear: registry.clear,
    getNodeInfo: registry.getNodeInfo,
    getNodeList: registry.getNodeList,
    getNodeConfigs: registry.getAllNodeConfigs,
    getNodeConfig: registry.getNodeConfig,
    removeNode: registry.removeNode,
    enableNode: registry.enableNodeSet,
    disableNode: registry.disableNodeSet
}
