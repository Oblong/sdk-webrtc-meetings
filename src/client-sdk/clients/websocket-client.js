var _               = require('underscore');
var Promise         = require('bluebird');
var SockJS          = require('sockjs-client');
var StateMachine    = require('state_machine');

module.exports = function() {
    var transition      = StateMachine.transitions.transition;
    var afterTransition = StateMachine.transitions.afterTransition;
    var anyOf           = StateMachine.triggers.anyOf;

    var registrationKey = 'meeting.register';
    var accessToken;
    var connectParams;
    var seamGuid;
    var joinTimeout;
    var customOptsList = [];
    var sock = null;
    var call;
    var invokeIfImplemented = function (collection, methodName, arg) {
        return _.invoke(_.filter(collection, function (item) {
                                                return item[methodName] !== undefined;
                                            }
                                ), methodName, arg);
    };
    var reconnects = 0;

    var eventHandlers = {};

    var sockjs_protocols = [
        'websocket', 'xdr-streaming', 'xhr-streaming',
        'xdr-polling', 'xhr-polling', 'iframe-xhr-polling',
        'jsonp-polling'
    ];
    //if (options.browser == 'safari') {
    //    sockjs_protocols = _.without(sockjs_protocols, 'websocket');
    //}

    var isJoinEvent = function (eventName) {
        return eventName === registrationKey;
    };
    var maxReconnects = 1000;
    var reconnectBackoff = 1000;
    var keepAliveTimeout = 20 *1000;
    var keepAliveTimer;


    var onAfterConnected = function () {
    };
    var onAfterClosed = function () {
        sock.close();
        console.log("Closing Socket...");
    };
    var onReconnecting = function () {
        if(joinTimeout) {
            clearTimeout(joinTimeout);
        }
        if (reconnects === maxReconnects) {
            console.log("Cannot setup sockJS connection, max reconnects attempted");
        }

        setTimeout(function() {
            if (reconnects < maxReconnects) {
                setTimeout(function() {
                    invokeIfImplemented(_.values(eventHandlers), "onBeforeReconnect", reconnects);
                    connect(connectParams, true);
                    reconnects++;
                }, reconnectBackoff * (reconnects > 10 ? 10 : reconnects));
            }
        }, 100);
    };


    var call = StateMachine.create({
        initial: 'idle',
        events: {
            register: transition({from: ['idle'], to: 'connecting'}),
            assignGuid: transition({from: ['connecting','reconnecting'], to: 'connected'}),
            close: transition({from: 'connected', to: 'disconnected'}),
            closedUnexpectedly: transition({from: 'connected', to: 'reconnecting'}),
            reconnect: transition({from: ['connecting', 'reconnecting', 'disconnected'], to: 'reconnecting'})
        },
        triggers: [{
            event: 'close',
            activatedBy: anyOf(['remoteClose', 'pairingError', 'kicked', 'crash', 'idleTimeout' ,'clientClose'])
        }, {
            event: 'closedUnexpectedly',
            activatedBy: anyOf(['networkIssue'])
        }],
        callbacks: [
            afterTransition({to: 'closed'}, onAfterClosed),
            afterTransition({to: 'connected'}, onAfterConnected),
            afterTransition({to: 'reconnecting'}, onReconnecting)
        ]
    });

    var isConnected = function () {
        return call.getState() === 'connected';
    };

    var events = function () {
        return {
            guid_assigned: guidAssigned,
            remoteclose: function () {
                console.log("remote close");
                call.trigger('remoteClose');
            },
            pairingError: function () {
                call.trigger('pairingError');
            },
            kicked: function () {
                call.trigger('kicked');
            }
        };
    };

    var sendEvent = function (event_name, event_data) {
        if (isJoinEvent(event_name) || isConnected()) {
            //console.log("sending", JSON.stringify([event_name, event_data || {}]));
            sock.send(JSON.stringify([event_name, event_data || {}]));
        }
        else {
            console.log("Cant send event yet -- sock or guid not ready");
        }
    };

    var guidAssigned = function (event) {
        seamGuid = event.seamGuid;
        console.log("Self GuidAssigned", seamGuid);
        call.assignGuid();
        //console.log("list of eventHandlers = ", eventHandlers);
        invokeIfImplemented(_.values(eventHandlers), "onConnect", event);
    };


    var close = function () {
        console.log("client side closing");
        if(joinTimeout) {
            clearTimeout(joinTimeout);
        }
        call.trigger('clientClose');
        sock.close("3077", "client-closing on keep alive failure");
    };

    var register = function (params) {
        //debug("register: params = ", params);
        var coreOpts = {
            access_token: params.oauthInfo.access_token,
            numeric_id:   params.oauthInfo.scope.meeting.meetingNumericId,
            leader_id:    params.oauthInfo.scope.meeting.leaderId,
            protocol:     "2",
            events:       params.events,
            user: {
                full_name: params.user.name,
                is_leader: params.user.leaderId
            }
        };

        var opts = _.extend.apply(null, _.union([{}, coreOpts], _.map(customOptsList, function (customOpts) {
            return _.isFunction(customOpts) ? customOpts() : customOpts;
        })));
        call.register();
        console.log("register: on state = " + call.getState() + ", message = " + registrationKey + ", " +
            JSON.stringify(opts));

        sendEvent(registrationKey, opts);
        //console.log("register: setting up guid assigned timeout");
        var guidAssignedTimeout = setTimeout(function() {
            //console.log("guid assigned timed out fired");
            if(call.getState() !== "connected") {
                console.log("reconnecting as NO guid_assigned during timeout");
                console.log(call.getState());
                call.reconnect();
            } else {
                //console.log("guid assigned timeout cleared");
                clearTimeout(guidAssignedTimeout);
            }
        }, 5000);
    };

    var _keepAliveFailure = function () {
        console.log("keepAliveFailure: keep alive failure. Socket is probably dead. Closing socket");
        close();
    };

    var _restartKeepAliveTimer = function () {
        if (keepAliveTimer) {
            clearTimeout(keepAliveTimer);
        }
        keepAliveTimer = setTimeout(function () {
            _keepAliveFailure();
        }, keepAliveTimeout);
    };

    var connect = function(params, reconnecting) {
        //console.log("connect: Meeting Token = " + meetingAccessToken)
        return new Promise(function(resolve, reject) {
            eventHandlers['guidAssigned'] = {onConnect: resolve};
            if (reconnecting) {
                console.log("Reconnecting");
                console.log(call.getState());
            }

            connectParams = params;
            console.log("Params = ", connectParams);
            console.log("websocketUrl = ", connectParams.websocketURL);
            sock = new SockJS(connectParams.websocketURL, {}, {
                cookie: true,
                protocols_whitelist: sockjs_protocols
            });
            joinTimeout = setTimeout(function () {
                if (!isConnected()) {
                    console.log("closing due to socket timeout");
                    call.close();
                    call.reconnect();
                } else {
                    clearTimeout(joinTimeout);
                }
            }, 15000);

            accessToken = connectParams.access_token;
            sock.onopen = function () {
                register(connectParams);
                invokeIfImplemented(_.values(eventHandlers), "onopen", connectParams);
            };
            sock.onmessage = function (_e) {
                try {
                    var msg = JSON.parse(_e.data);
                    if (msg.length == 2 && typeof msg[1] === 'object') {
                        var evt = msg[0];
                        //console.log("EVT = ", evt);
                        switch (evt) {
                            case 'keepalive':
                                //_restartKeepAliveTimer();
                                sendEvent("heartbeat");
                                break;
                            case 'refresh':
                                break;

                            default:
                                var evt_data = msg[1];
                                //console.log("0) evt = ", evt);
                                //console.log("0) evt_data = ", evt_data);
                                var protocolEvent = evt.match("([^.]*)$")[0];
                                if (protocolEvent in events()) {
                                    //console.log("1) protocolEvent = ", protocolEvent, " msg ", msg[0]);
                                    events()[protocolEvent](evt_data);
                                } else {
                                    var namespaces = _.keys(eventHandlers);
                                    //console.log("2) namespace = ", namespaces);
                                    //console.log("2) eventhandlers = ", eventHandlers);

                                    var eventNamespace = _.find(namespaces, function (namespace) {
                                        return evt.match("^" + namespace);
                                    });
                                    //console.log("3) eventNameSpace = ", eventNamespace);
                                    //console.log("3) eventHandlers[eventNamespace] = ",eventHandlers[eventNamespace]);
                                    if (eventHandlers[eventNamespace] && eventHandlers[eventNamespace].onMessage) {
                                        eventHandlers[eventNamespace].onMessage(evt, evt_data);
                                    }
                                }
                                break;
                        }
                    }
                    else {
                        console.log("JSON Received but not valid event: " + (msg[0] || ""));
                    }
                }
                catch (e) {
                    console.log("Invalid JSON from SockJSClient - " + _e.data, e);
                }
            };
            sock.onclose = function (e) {
                if (call.getState() === 'connected') {
                    call.closedUnexpectedly();
                }
            };
            sock.onerror = function (e) {
                console.log("Error Handler called.", e);
                invokeIfImplemented(_.values(eventHandlers), "onError", e);
            };
        });
    };

    return {
        sendEvent: sendEvent,
        connect: connect,
        close: close,
        registerHandler: function (handler, namespace, customOpts) {
            eventHandlers[namespace] = handler;
            if (customOpts) {
                customOptsList.push(customOpts);
            }
        }
    };
}
