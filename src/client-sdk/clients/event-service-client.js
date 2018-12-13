
/**
 * Created by nitesh on 16/09/16.
*/
var providedConfig           = require('../../config');
var ParticipantsCollection   = require('../models/participants-collection');
var Roster                   = require('../roster');
var WSC                      = require('./websocket-client');
var Logger                   = require('Logger');

module.exports = function() {
    var WebSocketClient = WSC()
    var defaultConfig = {
        user: {
            name: "Client_SDK_Test"
        },
        events: ["meeting", "endpoint"]
    };
    var config = providedConfig ? providedConfig: defaultConfig;

    var participantsCollection  = new ParticipantsCollection();
    var roster                  = new Roster(participantsCollection, {init: true});
    var verbose                 = false;

    /********
     * @method onChatMessage: On receiving a chat message, this method will be invoked.
     * @param msg
     */
    var onChatMessage = function(msg) {
        Logger.debug("MAIN: onChat msg = ", msg);
    };

    /********
     * @method onEndpointNotification: On receiving a endpoint level message, this method will be invoked.
     * @param msg: {
     * 				"timestamp": "<epochtime>",
     * 				"props": <f(full), a(added), m(modified), d(deleted)> [{ endpoint }],
     *				"event": "statechange.endpoints." + <meetingId>",
      *				"meetingGuid": "<meetingGuid>"
      *			}
      */
    var onEndpointNotification = function(msg) {
        if(verbose) Logger.debug("MAIN: onEndpointNotification msg = ", msg);
        var meetingGuid = msg.meetingGuid;
        if (msg.props && msg.props.f) {
            Logger.debug("MAIN: @" + msg.timestamp + " " + meetingGuid + " contain these eps: ");

            roster = roster ? roster : new Roster(new ParticipantsCollection());
            //Logger.debug("onFullRoster:2 roster = ", roster);
            roster.fullUpdate(msg.props, {init: true});
            Logger.debug("onFullRoster:3 roster = ", roster.collection);

            if(verbose) msg.props.f.forEach(function (eps) {
                Logger.debug("MAIN: @" + msg.timestamp + " " + eps.n + "(" + eps.E1 + ") as a " + eps.e + " (" + eps.t + ")");

            })
        }
        if (msg.props && msg.props.a) {
            roster.partialUpdate(msg.props);
            if(verbose) msg.props.a.forEach(function (eps) {
                Logger.debug("MAIN: @" + msg.timestamp + " " + eps.n + "(" + eps.E1 + ") is added to "
                    + meetingGuid + " as a " + eps.e + " (" + eps.t + ")");
            })
        }
        /****
         * You may don't need to implement modified endpoint functionalities.
         */
        if (msg.props && msg.props.m) {
            roster.partialUpdate(msg.props);
            if(verbose) {
        Logger.debug("partialUpdate: roster = ", roster.collection);
        Logger.debug("partialUpdate: self = ", roster.selfParticipant);

        msg.props.m.forEach(function (eps) {
          Logger.debug("MAIN: @" + msg.timestamp + " " + eps.E1 + " is modified");
        })
      }
        }
        if (msg.props && msg.props.d) {
            roster.partialUpdate(msg.props);
      if(verbose) {
        Logger.debug("partialUpdatedelete: roster = ", roster.collection);
        Logger.debug("partialUpdatedelete: self = ", roster.selfParticipant);
        msg.props.d.forEach(function (eps) {
          Logger.debug("MAIN: @" + msg.timestamp + " " + eps.n + "(" + eps.E1 + ") is deleted from " + meetingGuid);
        })
            }
        }
    };

    /********
     *
     * @method onMeetingNotification: On receiving a meeting level property, this method will be invoked.
     * @param msg: {
     * 				timestamp: <epochtime>,
     * 				props: <meeting property object>,
     *				event: "statechange.livemeeting." + <meetingId",
      *			}
      */
    var onMeetingNotification = function(msg) {
    if(verbose) {
      Logger.debug("MAIN: onMeetingNotification msg = ", msg);
      Logger.debug("MAIN: @" + msg.timestamp + " " + msg.props.meetingId + " (" + msg.props.meetingGuid + ") has title = "
        + msg.props.title + " is " + msg.props.status);
    }
    };

    /********
     *
     * @method onDialoutNotification: On receiving a dialout related messages, this method will be invoked.
     * @param msg : {
     * 				timestamp: <epochtime>,
     * 				event: "dialout.notification",
     * 				statusCode: <sip event code>,	// eg. 100, 	102, 	  106
     *				status: <sip status>			// eg. dialing, answered, busy
      * 			}
      */
    var onDialoutNotification = function(msg) {
    if(verbose) {
      Logger.debug("MAIN: onDialoutNotification msg = ", msg);
      Logger.debug("MAIN: @" + msg.timestamp + " dialout statusCode = " + msg.status + " (" + msg.statusCode + ")");
    }
    };

    /*********
     *
     * @param aggregateAPIResponse
     * @param cb
     */
    var connect = function(aggregateAPIResponse, cb) {
        var params = {
            websocketURL: aggregateAPIResponse.events.url,
            oauthInfo: aggregateAPIResponse.oauthInfo,
            user: {
                name: config.user.name,
                leaderId: aggregateAPIResponse.oauthInfo.scope.meeting.leaderId
            },
            events: config.events
        };

        WebSocketClient.registerHandler({onMessage: function(evt, data) {
            var msg = {};
            if (data.body && data.body) {
                try {
                    msg = JSON.parse(data.body);
                } catch (e) {
                    Logger.debug("corrupted json message body", e);
                }
                msg.timestamp = data.timestamp;
                if (msg.event) {
                    if (msg.event.substr(0, 21) === "statechange.endpoints") {
                        onEndpointNotification(msg);
                    } else if (msg.event.substr(0, 23) === "statechange.livemeeting") {
                        onMeetingNotification(msg);
                    } else if (msg.event === "dialout.notification") {
                        onDialoutNotification(msg);
                    }
                }
            }
        }}, 'meeting.notification.msg');

        WebSocketClient.connect(params).then(function (joinedEvent) {
            Logger.debug("MAIN: WEBSOCKET connect sucess ", joinedEvent);
            /**
             *	For sending the chat messages
              */
            //WebSocketClient.sendEvent("meeting.chat.msg", {
            //	msg: "message" + number++
            //});

            var selfParticipant = {};
            selfParticipant.E1 = joinedEvent.seamGuid;
            selfParticipant.ch = joinedEvent.guid ? joinedEvent.guid: "";
            selfParticipant.m  = joinedEvent.meetingGuid ? joinedEvent.meetingGuid: "";

            Logger.debug("local selfParticipant = ", selfParticipant);

            roster.assignedSelf(selfParticipant);
            Logger.debug("roster.selfParticipant = ", roster.selfParticipant);

            WebSocketClient.registerHandler({onMessage: function(evt, data) {
                onChatMessage(data);
            }}, 'meeting.chat.msg');

            WebSocketClient.onBeforeReconnect = function (reconnectAttempt) {
                Logger.debug('attempt', reconnectAttempt);
            };

            WebSocketClient.onError = function (err) {
                Logger.debug('error', err);
            };

        }).error(function (err) {
            Logger.debug('could not able to create websocket connection to BJN cloud', err);
        });
    };

    //TODO: cleanup  the connection
    var close = function () {
        Logger.debug("WebSocketClient.close executed");
        WebSocketClient.close();
    };

    var setLogging = function(turnOn) {
    Logger.debug("EventServiceClient verbose logging: " + turnOn);
    verbose = turnOn;
    };

    return {
      connect: connect,
      close: close,
      roster: roster,
      setLogging : setLogging
    };
}
