/*******************************************************************************

    uBlock - a browser extension to block requests.
    Copyright (C) 2015 Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/* global µBlock */

/******************************************************************************/

µBlock.staticFilteringReverseLookup = (function() {

'use strict';

/******************************************************************************/

var worker = null;
var workerTTL = 11 * 60 * 1000;
var workerTTLTimer = null;
var needLists = true;
var messageId = 1;
var pendingResponses = Object.create(null);

/******************************************************************************/

var onWorkerMessage = function(e) {
    var msg = e.data;
    var callback = pendingResponses[msg.id];
    delete pendingResponses[msg.id];
    callback(msg.response);
};

/******************************************************************************/

var stopWorker = function() {
    workerTTLTimer = null;
    if ( worker === null ) {
        return;
    }
    worker.terminate();
    worker = null;
    needLists = true;
    pendingResponses = Object.create(null);
};

/******************************************************************************/

var initWorker = function(callback) {
    //console.log('initWorker:',callback);
    if ( worker === null ) {
        //console.log("CREATING NEW WORKER");
        worker = new Worker('js/reverselookup-worker.js');
        worker.onmessage = onWorkerMessage;
    }

    if ( needLists === false ) {
        //console.log("BAIL1");
        //console.log("BAIL0", entries);

        callback();
        return;
    }

    needLists = false;

    var entries = Object.create(null);
    var countdown = 0;

    var onListLoaded = function(details) {
        var entry = entries[details.path];
        entry.content = details.content; // ADN
        //console.log('onListLoaded:',entry);

        // https://github.com/gorhill/uBlock/issues/536
        // Use path string when there is no filter list title.

        //entry.content = details.content;
        worker.postMessage({
            what: 'setList',
            details: {
                path: details.path,
                title: entry.title || details.path,
                supportURL: entry.supportURL,
                content: details.content
            }
        });

        countdown -= 1;
        //console.log("COUNTDOWN:"+countdown);
        if ( countdown === 0 ) {
            //console.log("BAIL1", entries);
            callback(entries); // ADN
        }
    };

    var µb = µBlock;
    var path, entry;

    //console.log("µb.remoteBlacklists", µb.remoteBlacklists);

    for ( path in µb.remoteBlacklists ) {

        if ( µb.remoteBlacklists.hasOwnProperty(path) === false ) {
            continue;
        }
        entry = µb.remoteBlacklists[path];
        if ( entry.off === true ) {
            continue;
        }
        //console.log("path", path, entry.content);
        entries[path] = {
            title: path !== µb.userFiltersPath ? entry.title : vAPI.i18n('1pPageName'),
            supportURL: entry.supportURL || ''
        };
        countdown += 1;
    }

    if ( countdown === 0 ) {
        //console.log("BAIL2", entries);
        callback();
        return;
    }

    for ( path in entries ) {
        µb.getCompiledFilterList(path, onListLoaded);
    }

    //console.log("DONE");
};

/******************************************************************************/
// var fromNetFilterSync = function(compiledFilter, rawFilter) {
//     console.log('reverseLookup.fromNetFilterSync:',worker);
//     return worker ? worker.listEntries : null;
// };

var fromNetFilter = function(compiledFilter, rawFilter, callback) {

    console.log('reverseLookup.fromNetFilter',
        'compiledFilter:',compiledFilter,'rawFilter:',rawFilter);

    if ( typeof callback !== 'function' ) {
        return;
    }

    if ( compiledFilter === '' || rawFilter === '' ) {
        callback();
        return;
    }

    if ( workerTTLTimer !== null ) {
        clearTimeout(workerTTLTimer);
        workerTTLTimer = null;
    }

    var onWorkerReady = function() {
        var id = messageId++;
        var message = {
            what: 'fromNetFilter',
            id: id,
            compiledFilter: compiledFilter,
            rawFilter: rawFilter
        };
        pendingResponses[id] = callback;
        worker.postMessage(message);

        // The worker will be shutdown after n minutes without being used.
        workerTTLTimer = vAPI.setTimeout(stopWorker, workerTTL);
    };

    initWorker(onWorkerReady);
};

/******************************************************************************/

var fromCosmeticFilter = function(hostname, rawFilter, callback) {
    if ( typeof callback !== 'function' ) {
        return;
    }

    if ( rawFilter === '' ) {
        callback();
        return;
    }

    if ( workerTTLTimer !== null ) {
        clearTimeout(workerTTLTimer);
        workerTTLTimer = null;
    }

    var onWorkerReady = function() {
        var id = messageId++;
        var message = {
            what: 'fromCosmeticFilter',
            id: id,
            domain: µBlock.URI.domainFromHostname(hostname),
            hostname: hostname,
            rawFilter: rawFilter
        };
        pendingResponses[id] = callback;
        worker.postMessage(message);

        // The worker will be shutdown after n minutes without being used.
        workerTTLTimer = vAPI.setTimeout(stopWorker, workerTTL);
    };

    initWorker(onWorkerReady);
};

/******************************************************************************/

// This tells the worker that filter lists may have changed.

var resetLists = function() {
    needLists = true;
    if ( worker === null ) {
        return;
    }
    worker.postMessage({ what: 'resetLists' });
};

/******************************************************************************/

return {
    fromNetFilter: fromNetFilter,
    //fromNetFilterSync: fromNetFilterSync,
    fromCosmeticFilter: fromCosmeticFilter,
    resetLists: resetLists,
    initWorker: initWorker,
    shutdown: stopWorker
};

/******************************************************************************/

})();

/******************************************************************************/
