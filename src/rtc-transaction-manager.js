var my                   = require('myclass');
var _                    = require('underscore');
var q                    = require('q');
var Backbone             = require('backbone');
var RTCTransactionModel  = require('./rtc-transaction-model');
var RTCBlueJay           = require('./rtc-bluejay');
var RTCStates            = require('./rtc-states');
var Logger               = require('Logger');
var RTCStateManager      = require('./rtc-state-manager');

var RTCTransactionManager = my.Class({
    config: {
        requestTimeout: 5000,
        keepaliveTimeout : 10000,
        maxRetransmitAttempts: 3
    },

    STATIC: {
        METHODS: RTCBlueJay.METHODS
    },

    constructor: function() {
        _.bindAll(this);
        _.extend(this, Backbone.Events);
        this.model = new RTCTransactionModel();
        this.requestTimers = {};
    },

    onRequest: function(messageId) {
        var self = this;
        var callbackWithMessageId =  function() {
            self.onRequestTimeout(messageId);
        };
        this.requestTimers[messageId] = setInterval(callbackWithMessageId, this.config.requestTimeout);
    },

    onBlueJayRequest: function(requestMessage) {
        this.model.addRequest(requestMessage.id, {
            method              : requestMessage.method,
            message             : requestMessage,
            state               : 'init',
            retransmitAttempts  : 0
        });

        //special message handling for BlueJay Request Message
        switch(requestMessage.method) {
            case RTCBlueJay.METHODS.MUTE :
                var prevMuteMsgID = this.model.getMuteMessage();
                if (!_.isUndefined(prevMuteMsgID)) {
                    this.removeRequestTransaction(prevMuteMsgID)
                }
                this.model.addMuteMessage(requestMessage.id);
                break;

            case RTCBlueJay.METHODS.TOKEN :
                var prevTokenMsgId = this.model.getTokenMessage();
                if (!_.isUndefined(prevTokenMsgId)) {
                    this.removeRequestTransaction(prevTokenMsgId)
                }
                this.model.addTokenMessage(requestMessage.id);
                break;

            default :
                break ;
        }
        //Start the request timer
        this.onRequest(requestMessage.id);
    },

    removeRequestTransaction: function(messageId) {
        if (!_.isUndefined(this.requestTimers[messageId]))
        {
            clearInterval(this.requestTimers[messageId]);
            delete this.requestTimers[messageId];
        }
        this.model.removeRequest(messageId);
    },

    onOutgoingBlueJayResponse: function(messageId, response) {
        this.model.addResponse(messageId, {response: response});
    },

    onIncomingBlueJayResponse: function(messageId) {
        var requestMessage = this.model.getRequest(messageId);
        if (!_.isUndefined(requestMessage)) {
            //request response is received, remove the message from the transaction
            this.removeRequestTransaction(messageId);
            //special message handling
            switch(requestMessage.method) {
                case RTCBlueJay.METHODS.CONNECT:
                    this.model.set('connectResponseReceived', true);
                    this.trigger('receivedConnectResponse');
                    break;
                case RTCBlueJay.METHODS.DISCONNECT:
                    this.trigger('closeSocketConnection');
                    break;
                default:
                    break;
                }
        }
        else if(this.model.get('bluejayKeepAlive').messageId == messageId) {
            this.model.addKeepAlive({messageId : messageId, state : 'finished' });
        }
    },

    lookupOutgoingResponse: function(messageId) {
        return this.model.getResponse(messageId);
    },

    //Keep alive messages are handeled seperately
    onKeepaliveRequest: function (messageId) {
        this.model.addKeepAlive({messageId : messageId, state : 'init'});
    },

    getKeepaliveMessageState: function() {
        return this.model.get('bluejayKeepAlive').state;
    },

    onRequestTimeout: function (messageId) {
        var requestTransaction = this.model.getRequest(messageId);
        if (requestTransaction.method === RTCBlueJay.METHODS.DISCONNECT) {
            this.removeRequestTransaction(messageId);
            this.trigger('closeSocketConnection');
            return ;
        }

        if (!_.isUndefined(requestTransaction)) {
            switch(requestTransaction.state) {
                case 'init' :
                case 'resend' :
                    this.retransmitRequest(requestTransaction, messageId);
                    break;
                default :
                    break;
            }
        }
    },

    retransmitRequest: function(requestTransaction, messageId) {
        if (requestTransaction.retransmitAttempts >= this.config.maxRetransmitAttempts) {
            Logger.warn('RTCTransactionManager: Request timeout occured for - Method :' +
                requestTransaction.method + ' :: Id - ' + messageId );
            this.removeRequestTransaction(messageId);
            this.trigger('requestTimeout', {'messageId' : messageId , 'method' : requestTransaction.method});
        } else {
            requestTransaction.state = 'resend';
            requestTransaction.retransmitAttempts++;
            this.trigger('retransmitRequest', requestTransaction.message);
            this.model.addRequest(messageId, requestTransaction);
        }
    },

    getRequestMessage: function(messageId) {
        return this.model.getRequest(messageId).message;
    },

    updateCallState: function(state){
        this.model.set('callState', state);
    },

    reset: function() {
        _.each(this.requestTimers, function(timer){
            clearInterval(timer);
        });
        this.model.resetTransaction();
    }
});

module.exports = new RTCTransactionManager();
