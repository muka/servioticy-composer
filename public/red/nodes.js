/**
 * Original work Copyright 2013 IBM Corp.
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
RED.nodes = function() {

    var node_defs = {};
    var nodes = [];
    var configNodes = {};
    var links = [];
    var defaultWorkspace;
    var workspaces = {};
    var streams = [];
    var groups = [];
    var xIndex = 0;
    var yIndex = 0;

    function registerType(nt,def) {
        node_defs[nt] = def;
        // TODO: too tightly coupled into palette UI
        RED.palette.add(nt,def);
    }

    function getID() {
        return (1+Math.random()*4294967295).toString(16);
    }

    function getType(type) {
        return node_defs[type];
    }

    function addNode(n) {
        if (n._def.component == "stream") {
            streams.push(n);
        } else if (n._def.component == "group") {
            groups.push(n);
        } else{
            return;
        }
        n.dirty = true;
        nodes.push(n);
    }
    function addLink(l) {
        links.push(l);
    }
    function addConfig(c) {
        configNodes[c.id] = c;
    }

    function getNode(id) {
        if (id in configNodes) {
            return configNodes[id];
        } else {
            for (var n in nodes) {
                if (nodes[n].id == id) {
                    return nodes[n];
                }
            }
        }
        return null;
    }

    function removeNode(id) {
        var removedLinks = [];
        if (id in configNodes) {
            delete configNodes[id];
            RED.sidebar.config.refresh();
        } else {
            var node = getNode(id);
            if (node) {
                nodes.splice(nodes.indexOf(node),1);
                // If it is an stream
                if(node._def.component == "stream") {
                    streams.splice(streams.indexOf(node), 1);
                }
                // If it is a group
                if(node._def.component == "group") {
                    groups.splice(groups.indexOf(node), 1);
                }
                removedLinks = links.filter(function(l) { return (l.source === node) || (l.target === node); });
                removedLinks.map(function(l) {links.splice(links.indexOf(l), 1); });
            }
            var updatedConfigNode = false;
            for (var d in node._def.defaults) {
                var property = node._def.defaults[d];
                if (property.type) {
                    var type = getType(property.type)
                    if (type && type.category == "config") {
                        var configNode = configNodes[node[d]];
                        if (configNode) {
                            updatedConfigNode = true;
                            var users = configNode.users;
                            users.splice(users.indexOf(node),1);
                        }
                    }
                }
            }
            if (updatedConfigNode) {
                RED.sidebar.config.refresh();
            }
        }
        return removedLinks;
    }

    function removeLink(l) {
        var index = links.indexOf(l);
        if (index != -1) {
            links.splice(index,1);
        }
    }

    function refreshValidation() {
        for (var n in nodes) {
            RED.editor.validateNode(nodes[n]);
        }
    }

    function addStream(s) {
        streams.push(s);
    }
    function getStream(id) {
        return workspaces[id];
    }

    function addWorkspace(ws) {
        workspaces[ws.id] = ws;
    }
    function getWorkspace(id) {
        return workspaces[id];
    }
    function removeWorkspace(id) {
        delete workspaces[id];
        var removedNodes = [];
        var removedLinks = [];
        for (var n in nodes) {
            var node = nodes[n];
            if (node.z == id) {
                removedNodes.push(node);
            }
        }
        for (var n in removedNodes) {
            var rmlinks = removeNode(removedNodes[n].id);
            removedLinks = removedLinks.concat(rmlinks);
        }
        return {nodes:removedNodes,links:removedLinks};
    }

    function getAllFlowNodes(node) {
        var visited = {};
        visited[node.id] = true;
        var nns = [node];
        var stack = [node];
        while(stack.length != 0) {
            var n = stack.shift();
            var childLinks = links.filter(function(d) { return (d.source === n) || (d.target === n);});
            for (var i in childLinks) {
                var child = (childLinks[i].source === n)?childLinks[i].target:childLinks[i].source;
                if (!visited[child.id]) {
                    visited[child.id] = true;
                    nns.push(child);
                    stack.push(child);
                }
            }
        }
        return nns;
    }

    /**
     * Converts a node to an exportable JSON Object
     **/
    function convertNode(n) {
        var node = {};
        node.id = n.id;
        node.type = n.type;
        for (var d in n._def.defaults) {
            node[d] = n[d];
        }
        if (n._def.category != "config") {
            node.x = n.x;
            node.y = n.y;
            node.z = n.z;
            node.wires = [];
            for(var i=0;i<n.outputs;i++) {
                node.wires.push([]);
            }
            var wires = links.filter(function(d){return d.source === n;});
            for (var i in wires) {
                var w = wires[i];
                node.wires[w.sourcePort].push(w.target.id);
            }
        }
        return node;
    }

    /**
     * Converts the current node selection to an exportable JSON Object
     **/
    function createExportableNodeSet(set) {
        var nns = [];
        var exportedConfigNodes = {};
        for (var n in set) {
            var node = set[n].n;
            var convertedNode = RED.nodes.convertNode(node);
            for (var d in node._def.defaults) {
                if (node._def.defaults[d].type && node[d] in configNodes) {
                    var confNode = configNodes[node[d]];
                    var exportable = getType(node._def.defaults[d].type).exportable;
                    if ((exportable == null || exportable)) {
                        if (!(node[d] in exportedConfigNodes)) {
                            exportedConfigNodes[node[d]] = true;
                            nns.unshift(RED.nodes.convertNode(confNode));
                        }
                    } else {
                        convertedNode[d] = "";
                    }
                }
            }

            nns.push(convertedNode);
        }
        return nns;
    }

    function generateHeader(wires){
        var header = "function(";
        if(wires !== undefined && wires !== null && wires.length != 0){
            header += wires[0].source.name;
        }
        for(var i = 1;i < wires.length;i++){
            header += ",";
            header += wires[i].source.name;
        }
        header += ")";

        return header;
    };

    function convertToStream(s){
        // TODO Check defaults?
        var stream = {};
        var header = generateHeader(links.filter(function(l){return l.target === s;}));
        stream.channels = {};
        for (var i=0;i<s.channels.length;i++){
            stream.channels[s.channels[i].name] = {};
            if(s.channels[i]["current-value"] !== undefined) {
                stream.channels[s.channels[i].name]['current-value'] = header + "{" + s.channels[i]["current-value"] + "}";
            }
            stream.channels[s.channels[i].name].type =  s.channels[i].type;
            stream.channels[s.channels[i].name].unit =  s.channels[i].unit;
        }
        return stream;
    }

    function convertToGroup(g){
        // TODO Check defaults?
        var group = {};
        group.soIds = g.soIds;
        group.stream = g.stream;
        return group;
    }

    function createSos(){
        var sos = {};
        var i;
        for (i in workspaces){
            sos[i] = {name: workspaces[i].label, key: workspaces[i].key, version: "0.2.0"};
        }
        for (i in groups) {
            if(sos[groups[i].z].groups === undefined){
                sos[groups[i].z].groups = {};
            }
            sos[groups[i].z].groups[groups[i].name] = convertToGroup(groups[i]);
        }
        for (i in streams) {
            if(sos[streams[i].z].streams === undefined){
                sos[streams[i].z].streams = {};
            }
            sos[streams[i].z].streams[streams[i].name] = convertToStream(streams[i]);
        }
        return sos;
    }
    //TODO: rename this (createCompleteNodeSet)
    function createCompleteNodeSet() {
        var nns = [];
        for (var i in workspaces) {
            nns.push(workspaces[i]);
        }
        for (var i in configNodes) {
            nns.push(convertNode(configNodes[i]));
        }
        for (var i in nodes) {
            var node = nodes[i];
            nns.push(convertNode(node));
        }
        return nns;
    }

    function extractStreamSources(stream){
        //TODO This needs to be cleaner
        var i;
        var sources = [];
        for(i in stream.channels){
            var cv = stream.channels[i]["current-value"];
            var j;
            var ns = cv.split('(')[1].split(')')[0].split(',');
            for(j in ns){
                var existing = sources.filter(function(s){
                    return ns[j] == s;
                });
                if(existing.length == 0) {
                    sources.push(ns[j]);
                }
            }
        }
        return sources;
    }

    function getCoordinates(){
        var xpx = 300;
        var ypx = 100;
        var marginy = 75;
        var marginx = 175;
        var coords = {x:xIndex*xpx+marginx, y:yIndex*ypx+marginy};
        if(yIndex >= 2*xIndex-1){
            yIndex = 0;
            xIndex++;
        }else{
            yIndex++;
        }

        return coords
    }

    function restartCoordinates(){
        xIndex = 0;
        yIndex = 0;
    }

    function importFunction(func){
        var body_parts = func.split('{')[1].split('}');
        var body = "";
        var i;
        for(i =0; i<body_parts.length-1;i++){
            body += body_parts[i];
        }
        return body;
    }

    function normalizeType(type){
        type = type.trim().toLowerCase();
        return type;
    }

    function importNodes(so,createNewIds) {
        try {
            var i;
            var sources = {};
            if (typeof so === "string") {
                if (so === "") {
                    return;
                }
                so = JSON.parse(so);
            }
            var node_map = {};
            var new_nodes = [];
            var new_groups = [];
            var new_streams =[];
            var new_links = [];
            restartCoordinates();
            var tabId;
            if(createNewIds){
                tabId = getID();
            }
            else{
                tabId = so.id || getID();
            }
            var workspaceIndex = 0;
            for(var prop in workspaces) {
                if(workspaces.hasOwnProperty(prop))
                    ++workspaceIndex;
            }
            workspaceIndex++;
            label = "Service Object "+workspaceIndex;
            var ws = {type:"tab",id:tabId,label: so.name || label};
            if (defaultWorkspace == null) {
                defaultWorkspace = ws;
            }
            addWorkspace(ws);
            RED.view.addWorkspace(ws);
            RED.view.showWorkspace((tabId))
            var newGroups = so.groups || {};
            var j;
            for(j in newGroups){
                var g = newGroups[j];
                var coor = getCoordinates();
                var gn = {name:j,component:"group",id:getID(),_def:getType("group"),type:"group",changed:false,stream:g.stream,soIds:g.soIds,x:coor.x,y:coor.y,z:tabId,wires:[[]]};
                gn._def=getType("group")
                gn.outputs = gn._def.outputs;
                new_groups.push(gn);
            }
            var newStreams = so.streams || {};
            for(j in newStreams){
                var s = newStreams[j];
                var composite;
                var sn;
                var k;
                var coor = getCoordinates();
                var channels = []
                for(k in s.channels){
                    composite = s.channels[k]["current-value"] !== undefined && s.channels[k]["current-value"] !== null;
                    break;
                }
                for(k in s.channels){
                    channels.push({name: k,unit:s.channels[k].unit,type:normalizeType(s.channels[k].type)});
                    channels[channels.length-1].name = k;
                    if(composite){
                        channels[channels.length-1]["current-value"] = importFunction(s.channels[k]["current-value"]);
                    }
                }
                sn = {name: j, id: getID(), type: "object", component: "stream",changed:false,channels:channels,x:coor.x,y:coor.y,z: tabId, wires: [[]]};
                sn._def=getType("object");
                sn.outputs = sn._def.outputs;
                if(composite) {
                    sn._def=getType("custom");
                    sn.outputs = sn._def.outputs;
                    sn.type="custom";
                    if(sources[sn.z] === undefined){
                        sources[sn.z] = {};
                    }
                    sources[sn.z][sn.id] = extractStreamSources(s);
                    // TODO Set wires
                }
                new_streams.push(sn);
            }
            if (defaultWorkspace == null) {
                defaultWorkspace = { type:"tab", id:getID(), label:"Service Object 1" };
                addWorkspace(defaultWorkspace);
                RED.view.addWorkspace(defaultWorkspace);
            }
            for(i in sources){
                for(j in sources[i]){
                    for(k in sources[i][j]){
                        var nname = sources[i][j][k];
                        var n=-1;
                        for(n in new_streams){
                            if(new_streams[n].name == nname && new_streams[n].z == i){
                                break;
                            }
                            n=-1
                        }
                        if(n == -1){
                            n = new_groups.findIndex(function(g){
                                return g.name == nname;
                            });
                            if(n == -1){
                                continue;
                            }
                            if (new_groups[n].wires === undefined){
                                new_groups[n].wires = [[]];
                            }
                            new_groups[n].wires[0].push(j);
                        }
                        else{
                            if (new_streams[n].wires === undefined){
                                new_streams[n].wires = [[]];
                            }
                            new_streams[n].wires[0].push(j);
                        }
                    }
                }
            }
            for (i=0;i<new_groups.length;i++) {
                var gn = new_groups[i];
                addNode(gn);
                RED.editor.validateNode(gn);
                node_map[gn.id] = gn;
                new_nodes.push(gn);
            }
            for (i=0;i<new_streams.length;i++) {
                var sn = new_streams[i];
                addNode(sn);
                RED.editor.validateNode(sn);
                node_map[sn.id] = sn;
                new_nodes.push(sn);
            }
            for (i=0;i<new_nodes.length;i++) {
                so = new_nodes[i];
                for (var w1=0;w1<so.wires.length;w1++) {
                    var wires = (so.wires[w1] instanceof Array)?so.wires[w1]:[so.wires[w1]];
                    for (var w2=0;w2<wires.length;w2++) {
                        if (wires[w2] in node_map) {
                            var link = {source:so,sourcePort:w1,target:node_map[wires[w2]]};
                            addLink(link);
                            new_links.push(link);
                        }
                    }
                }
                delete so.wires;
            }
            return [new_nodes,new_links];
        } catch(error) {
            //TODO: get this UI thing out of here! (see above as well)
            RED.notify("<strong>Error</strong>: "+error,"error");
            return null;
        }

    }

    return {
        registerType: registerType,
        getType: getType,
        convertNode: convertNode,
        add: addNode,
        addLink: addLink,
        remove: removeNode,
        removeLink: removeLink,
        addWorkspace: addWorkspace,
        removeWorkspace: removeWorkspace,
        workspace: getWorkspace,
        eachNode: function(cb) {
            for (var n in nodes) {
                cb(nodes[n]);
            }
        },
        eachLink: function(cb) {
            for (var l in links) {
                cb(links[l]);
            }
        },
        eachConfig: function(cb) {
            for (var id in configNodes) {
                cb(configNodes[id]);
            }
        },
        node: getNode,
        import: importNodes,
        refreshValidation: refreshValidation,
        getAllFlowNodes: getAllFlowNodes,
        createExportableNodeSet: createExportableNodeSet,
        createSOs: createSos,
        createCompleteNodeSet: createCompleteNodeSet,
        id: getID,
        nodes: nodes, // TODO: exposed for d3 vis
        links: links  // TODO: exposed for d3 vis
    };
}();
