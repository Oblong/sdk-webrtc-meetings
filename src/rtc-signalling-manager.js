/*
* Blue Jeans WebRTC Signalling Manager
* =====================================================================================
* @version In bower.json
* @uses custom JSON-based protocol to send connection establishment data to remote peer
*
*/

var my   				      = require('myclass');
var _       			    = require('underscore');
var Logger				    = require('Logger');
var io 					      = require('socket.io-client');
var RTCBlueJay 			  = require('./rtc-bluejay');
var RTCMessageParser 	= require('./rtc-message-parser');
var RTCStates         = require('./rtc-states');

var Backbone          = require('backbone');

var RTCSignallingManager = my.Class({

    STATIC: {
        MESSAGE_BASE: {"bluejay": "1.0"}
    },

    config: {
        'callId': null,
        'sockUrl': null,
        'socketId': null,
        'socketioOpts': {
            reconnectionAttempts:   15,
            reconnectionDelay:      2000,
            reconnectionDelayMax:   2500,
            timeout:                2000,
            forceNew:               true
        }
    },

    constructor : function(options) {
        _.bindAll(this);
        _.extend(this.config, options);
        _.extend(this, Backbone.Events);
        this.isConnected = false;
        this.WS_STATES = RTCStates.WS_STATES;
    },

    createSocket: function(params) {
        this.socket = io.connect(params.sockUrl, this.config.socketioOpts);
        this.setupListeners();
    },

    setupListeners: function() {
        this.socket.on('message', this.handleMessage);

        // below socket messages are emitted by socket.io. These are reserved messages.
        this.socket.on('connect', this.socketConnected);
        this.socket.on('error', this.socketError);
        this.socket.on('disconnect', this.socketDisconnect);
        this.socket.on('reconnecting', this.socketReconnecting);
        this.socket.on('reconnect_failed', this.socketReconnectFailed);
        this.socket.on('reconnect', this.socketReconnect);
        this.socket.on('connect_error', this.onConnectError);
    },

    setupMessageParser: function(signallingCallbacks) {
        this.messageParser = new RTCMessageParser({
            'callbacks': signallingCallbacks
        });
    },

    /* ============================= */
    /*    Socket Message Handlers    */
    /* ============================= */

    handleMessage: function(message) {
        Logger.debug("RTCSignallingManager: Received message on socket: " + message);
        this.messageParser.parseIncomingMessage(message);
    },

    socketConnected: function() {
        this.isConnected = true;
        this.config.socketId = this.socket.id;
        this.trigger('wsConnectionStateChange', this.WS_STATES.CONNECTED, this.socket.id);
        Logger.debug("RTCSignallingManager: Socket connected successfully");
    },

    socketError: function(error) {
        this.isConnected = false;
        this.trigger('wsConnectionStateChange', this.WS_STATES.DISCONNECTED, this.config.socketId);
        Logger.error("RTCSignallingManager: Received 'error' message on socket");
    },

    socketDisconnect: function(error) {
        this.isConnected = false;
        this.trigger('wsConnectionStateChange', this.WS_STATES.DISCONNECTED, this.config.socketId);

        if(error === "io client disconnect") {
            Logger.debug("RTCSignallingManager: Socket disconnected, initiated by client: ", error);
        } else {
            Logger.error("RTCSignallingManager: Socket disconnected, not initiated by client: ", error);
        }
    },

    socketReconnecting: function(number) {
        this.isConnected = false;
        Logger.debug("RTCSignallingManager: Reconnecting socket, reconnect attempt ", number);
    },

    socketReconnectFailed: function() {
        this.isConnected = false;
        this.trigger('wsConnectionStateChange', this.WS_STATES.FAILED, this.config.socketId);
        Logger.debug("RTCSignallingManager: Socket reconnection failed");
    },

    socketReconnect: function() {
        Logger.debug("RTCSignallingManager: Socket reconnected");
        this.isConnected = true;
        this.config.socketId = this.socket.id;
        this.trigger('wsConnectionStateChange', this.WS_STATES.RECONNECTED, this.socket.id);
    },

    onConnectError: function(error) {
        Logger.debug("RTCSignallingManager :: connect error : " + error);
    },

    sendMsg: function(msg) {
        if(_.isNull(msg.call) || _.isUndefined(msg.call)) {
            Logger.warn("RTCSignallingManager: Invalid BlueJay message, 'call' field is missing");
            return false;
        }
        if(!msg.id) {
            Logger.warn("RTCSignallingManager: Invalid BlueJay message, 'id' field is missing");
            return false;
        }
        if (!this.isConnected) {
            Logger.warn("RTCSignallingManager: Socket is not connected, Message :: " + JSON.stringify(msg));
            return false;
        }

        this.socket.emit('message', JSON.stringify(msg));
        Logger.debug("RTCSignallingManager: Sending socket message: " + JSON.stringify(msg));
        return true;
    },

    close: function() {
        if(this.socket) {
            this.isConnected = false;
            this.socket.disconnect();
            this.socket = null;
        } else {
            Logger.warn('RTCSignallingManager: Socket has already been closed.');
        }
    }

});

module.exports = new RTCSignallingManager();
