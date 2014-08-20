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

RED.nodes = (function() {

    var node_defs = {};
    var nodes = [];
    var configNodes = {};
    var links = [];
    var defaultWorkspace;
    var workspaces = {};
    var streams = [];
    var groups = [];
    var xIndex = 1;
    var yIndex = 1;
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
                removedLinks = links.filter(function(l) { return (l.source === node) || (l.target === node); });
                removedLinks.map(function(l) {links.splice(links.indexOf(l), 1); });
            }
            var updatedConfigNode = false;
            for (var d in node._def.defaults) {
                if (node._def.defaults.hasOwnProperty(d)) {
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
        for (var n=0;n<nodes.length;n++) {
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
        var n;
        for (n=0;n<nodes.length;n++) {
            var node = nodes[n];
            if (node.z == id) {
                removedNodes.push(node);
            }
        }
        for (n=0;n<removedNodes.length;n++) {
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
        while(stack.length !== 0) {
            var n = stack.shift();
            var childLinks = links.filter(function(d) { return (d.source === n) || (d.target === n);});
            for (var i=0;i<childLinks.length;i++) {
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
    function convertNode(n, exportCreds) {
        exportCreds = exportCreds || false;
        var node = {};
        node.id = n.id;
        node.type = n.type;
        for (var d in n._def.defaults) {
            if (n._def.defaults.hasOwnProperty(d)) {
                node[d] = n[d];
            }
        }
        if(exportCreds && n.credentials) {
            node.credentials = {};
            for (var cred in n._def.credentials) {
                if (n._def.credentials.hasOwnProperty(cred)) {
                    if (n.credentials[cred] != null) {
                        node.credentials[cred] = n.credentials[cred];
                    }
                }
            }
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
            for (var j=0;j<wires.length;j++) {
                var w = wires[j];
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
        for (var n=0;n<set.length;n++) {
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
            stream.channels[s.channels[i].name]['current-value'] = header + "{" + s.channels[i]["current-value"] + "}";
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
            sos[i] = {name: workspaces[i].label};
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
        var i;
        for (i in workspaces) {
            if (workspaces.hasOwnProperty(i)) {
                nns.push(workspaces[i]);
            }
        }
        for (i in configNodes) {
            if (configNodes.hasOwnProperty(i)) {
                nns.push(convertNode(configNodes[i], true));
            }
        }
        for (i=0;i<nodes.length;i++) {
            var node = nodes[i];
            nns.push(convertNode(node, true));
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
                sources.push(ns[j]);
            }
        }
        return sources;
    }

    function getCoordinates(){
        var px = 300;
        xIndex++;
        return {x:xIndex*px, y:yIndex*px}
    }

    function importNodes(sos,createNewIds) {
        try {
            var i;
            var n;
            var newSos;
            var sources = {};
            if (typeof sos === "string") {
                if (sos === "") {
                    return;
                }
                newSos = JSON.parse(sos);
            } else {
                newSos = sos;
            }

            if (!$.isArray(newSos)) {
                newSos = [newSos];
            }
            var node_map = {};
            var new_nodes = [];
            var new_links = [];
            for (i=0;i<newSos.length;i++) {
                n = newSos[i];
                var tabId;
                if(createNewIds){
                    tabId = getID();
                }
                else{
                    tabId = n.id || getID();
                }
                var workspaceIndex = 0;
                for(var prop in workspaces) {
                    if(workspaces.hasOwnProperty(prop))
                        ++workspaceIndex;
                }
                workspaceIndex++;
                label = "Service Object "+workspaceIndex;
                var ws = {type:"tab",id:tabId,label: n.name || label};
                if (defaultWorkspace == null) {
                    defaultWorkspace = ws;
                }
                addWorkspace(ws);
                RED.view.addWorkspace(ws);
                var newGroups = n.groups || {};
                var j;
                for(j in newGroups){
                    var g = newGroups[j];
                    var coor = getCoordinates();
                    var gn = {name:j,component:"group",id:getID(),_def:getType("group"),type:"group",changed:false,stream:g.stream,sos:g.soIds,x:coor.x,y:coor.y,z:tabId,wires:[[]]};
                    gn._def=getType("group")
                    gn.outputs = gn._def.outputs;
                    addNode(gn);
                    RED.editor.validateNode(gn);
                    node_map[n.id] = gn;
                    new_nodes.push(gn);
                }
                var newStreams = n.streams || {};
                for(j in newStreams){
                    var s = newStreams[j];
                    var composite;
                    var sn;
                    var k;
                    var coor = getCoordinates();
                    for(k in s.channels){
                        composite = s.channels[k]["current-value"] !== undefined && s.channels[k]["current-value"] !== null;
                        break;
                    }
                    sn = {name: j, id: getID(), type: "input", component: "stream",changed:false,channels: s.channels,x:coor.x,y:coor.y,z: tabId, wires: [[]]};
                    sn._def=getType("input")
                    sn.outputs = sn._def.outputs;
                    if(composite) {
                        sn._def=getType("custom");
                        sn.outputs = sn._def.outputs;
                        sn.type="custom";
                        sources[sn.id] = extractStreamSources(s);
                        // TODO Set wires
                    }
                    addNode(sn);
                    RED.editor.validateNode(sn);
                    node_map[n.id] = sn;
                    new_nodes.push(sn);
                }
            }
            if (defaultWorkspace == null) {
                defaultWorkspace = { type:"tab", id:getID(), label:"Service Object 1" };
                addWorkspace(defaultWorkspace);
                RED.view.addWorkspace(defaultWorkspace);
            }
// TODO This needs to be done before adding the node.
            for(i in sources){
                for(j in sources[i]){
                    var nname = sources[i][j];
                    var n = streams.filter(function(s){
                        return s.name == nname;
                    });
                    if(n.length == 0 ){
                        n = groups.filter(function(g){
                            return g.name == nname;
                        });
                    }
                    if(n.length == 0 ){
                        continue;
                    }
                    if(n[0].wires === undefined){
                        n[0].wires = [[]];
                    }
                    n[0].wires[0].push(i);
                }
            }
            for (i=0;i<new_nodes.length;i++) {
                n = new_nodes[i];
                for (var w1=0;w1<n.wires.length;w1++) {
                    var wires = (n.wires[w1] instanceof Array)?n.wires[w1]:[n.wires[w1]];
                    for (var w2=0;w2<wires.length;w2++) {
                        if (wires[w2] in node_map) {
                            var link = {source:n,sourcePort:w1,target:node_map[wires[w2]]};
                            addLink(link);
                            new_links.push(link);
                        }
                    }
                }
                delete n.wires;
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
            for (var n=0;n<nodes.length;n++) {
                cb(nodes[n]);
            }
        },
        eachLink: function(cb) {
            for (var l=0;l<links.length;l++) {
                cb(links[l]);
            }
        },
        eachConfig: function(cb) {
            for (var id in configNodes) {
                if (configNodes.hasOwnProperty(id)) {
                    cb(configNodes[id]);
                }
            }
        },
        node: getNode,
        import: importNodes,
        refreshValidation: refreshValidation,
        getAllFlowNodes: getAllFlowNodes,
        createExportableNodeSet: createExportableNodeSet,
        createSO: createSos,
        createCompleteNodeSet: createCompleteNodeSet,
        id: getID,
        nodes: nodes, // TODO: exposed for d3 vis
        links: links  // TODO: exposed for d3 vis
    };
})();