
/**
 * Created by nitesh on 16/09/16.
*/
var providedConfig           = require('../../config');
var ParticipantsCollection   = require('../models/participants-collection');
var Roster                   = require('../roster');
var WSC                      = require('./websocket-client');

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
        console.log("MAIN: onChat msg = ", msg);
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
        if(verbose) console.log("MAIN: onEndpointNotification msg = ", msg);
        var meetingGuid = msg.meetingGuid;
        if (msg.props && msg.props.f) {
            console.log("MAIN: @" + msg.timestamp + " " + meetingGuid + " contain these eps: ");

            roster = roster ? roster : new Roster(new ParticipantsCollection());
            //console.log("onFullRoster:2 roster = ", roster);
            roster.fullUpdate(msg.props, {init: true});
            console.log("onFullRoster:3 roster = ", roster.collection);

            if(verbose) msg.props.f.forEach(function (eps) {
                console.log("MAIN: @" + msg.timestamp + " " + eps.n + "(" + eps.E1 + ") as a " + eps.e + " (" + eps.t + ")");

            })
        }
        if (msg.props && msg.props.a) {
            roster.partialUpdate(msg.props);
            if(verbose) msg.props.a.forEach(function (eps) {
                console.log("MAIN: @" + msg.timestamp + " " + eps.n + "(" + eps.E1 + ") is added to "
                    + meetingGuid + " as a " + eps.e + " (" + eps.t + ")");
            })
        }
        /****
         * You may don't need to implement modified endpoint functionalities.
         */
        if (msg.props && msg.props.m) {
            roster.partialUpdate(msg.props);
            if(verbose) {
        console.log("partialUpdate: roster = ", roster.collection);
        console.log("partialUpdate: self = ", roster.selfParticipant);

        msg.props.m.forEach(function (eps) {
          console.log("MAIN: @" + msg.timestamp + " " + eps.E1 + " is modified");
        })
      }
        }
        if (msg.props && msg.props.d) {
            roster.partialUpdate(msg.props);
      if(verbose) {
        console.log("partialUpdatedelete: roster = ", roster.collection);
        console.log("partialUpdatedelete: self = ", roster.selfParticipant);
        msg.props.d.forEach(function (eps) {
          console.log("MAIN: @" + msg.timestamp + " " + eps.n + "(" + eps.E1 + ") is deleted from " + meetingGuid);
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
      console.log("MAIN: onMeetingNotification msg = ", msg);
      console.log("MAIN: @" + msg.timestamp + " " + msg.props.meetingId + " (" + msg.props.meetingGuid + ") has title = "
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
      console.log("MAIN: onDialoutNotification msg = ", msg);
      console.log("MAIN: @" + msg.timestamp + " dialout statusCode = " + msg.status + " (" + msg.statusCode + ")");
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
                    console.log("corrupted json message body", e);
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
            console.log("MAIN: WEBSOCKET connect sucess ", joinedEvent);
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

            console.log("local selfParticipant = ", selfParticipant);

            roster.assignedSelf(selfParticipant);
            console.log("roster.selfParticipant = ", roster.selfParticipant);

            WebSocketClient.registerHandler({onMessage: function(evt, data) {
                onChatMessage(data);
            }}, 'meeting.chat.msg');

            WebSocketClient.onBeforeReconnect = function (reconnectAttempt) {
                console.log('attempt', reconnectAttempt);
            };

            WebSocketClient.onError = function (err) {
                console.log('error', err);
            };

        }).error(function (err) {
            console.log('could not able to create websocket connection to BJN cloud', err);
        });
    };

    //TODO: cleanup  the connection
    var close = function () {
        console.log("WebSocketClient.close executed");
        WebSocketClient.close();
    };

    var setLogging = function(turnOn) {
    console.log("EventServiceClient verbose logging: " + turnOn);
    verbose = turnOn;
    };

    return {
      connect: connect,
      close: close,
      roster: roster,
      setLogging : setLogging
    };
}
