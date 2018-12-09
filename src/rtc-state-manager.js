var my   				  = require('myclass');
var _       			= require('underscore');
var Backbone 			= require('backbone');
var Logger				= require('Logger');
var StateMachine        = require('state_machine');
var RTCStates           = require('./rtc-states');

var RTCCallStateModel = Backbone.Model.extend({
    defaults: {
        currentState: "",
        prevState: [],
        iceConnectionState: "",
        iceGatheringState: "",
        signalingState: "",
        disconnectCode: "",
        disconnectReason: ""
    },

    setCurrentState: function(state) {
        var curState = this.get('currentState');
        var prevState = this.get('prevState');
        if(state !== curState) {
            prevState.push(curState);
            this.set('currentState', state);
        }
        this.logStateTransition();
    },

    logStateTransition: function() {
        Logger.debug("RTCStateManager: Call State: " + this.get('currentState') +
                    ", Ice-Gathering: " + this.get('iceGatheringState') +
                    ", Ice-Connection: " + this.get('iceConnectionState') +
                    ", Signaling: " + this.get('signalingState'));
    },

    getCurrentState: function(){
        return this.get('currentState');
    },

    getPreviousState: function(){
        return this.get('prevState');
    },

    getDisconnectReason: function() {
        return this.get('disconnectReason');
    }
});

var RTCStateManager = my.Class({

    STATIC: {
        BJ_CALLSTATES: RTCStates.BJ_CALLSTATES,
        ICE_G_STATES: RTCStates.addWebrtcStatePrefix('iceG_', RTCStates.WEBRTC_STATES.iceGatheringState),
        ICE_C_STATES: RTCStates.addWebrtcStatePrefix('ice_', RTCStates.WEBRTC_STATES.iceConnectionState),
        SIG_STATES: RTCStates.addWebrtcStatePrefix('sig_', RTCStates.WEBRTC_STATES.signalingState),
        STATE_EVTS: RTCStates.STATE_EVENTS
    },

    constructor: function(params){
        _.bindAll(this);
        _.extend(this, Backbone.Events);
        this.model = new RTCCallStateModel;
        this.stateMachine = this.initStateMachine();
    },

    initStateMachine: function() {

        var transition = StateMachine.transitions.transition;
        var anyOf = StateMachine.triggers.anyOf;
        var allOf = StateMachine.triggers.allOf;
        var BJ_CALLSTATES = RTCStateManager.BJ_CALLSTATES;
        var ICE_C_STATES = RTCStateManager.ICE_C_STATES;
        var ICE_G_STATES = RTCStateManager.ICE_G_STATES;
        var SIG_STATES = RTCStateManager.SIG_STATES;
        var STATE_EVTS = RTCStateManager.STATE_EVTS;
        var callStateChange = function(params){
            this.callStateChange(params);
        }.bind(this);

        return StateMachine.create({
            initial: BJ_CALLSTATES.IDLE,
            events: {
                // Normal flow: Initialise --> Connect --> StartMedia --> Establish Connection
                // ICE Restart Flow: (Re)Initialise --> (Re)Connect --> StartMedia --> Establish Connection
                initialise              : transition([{
                                                from : BJ_CALLSTATES.IDLE,
                                                to   : BJ_CALLSTATES.INITIALISING
                                            }, {
                                                from : BJ_CALLSTATES.RESTART_MEDIA,
                                                to   : BJ_CALLSTATES.REINITIALISING
                                            }]),
                connect                 : transition([{
                                                from : BJ_CALLSTATES.INITIALISING,
                                                to   : BJ_CALLSTATES.CONNECTING
                                            }, {
                                                from : BJ_CALLSTATES.REINITIALISING,
                                                to   : BJ_CALLSTATES.RECONNECTING
                                            }]),
                startMedia              : transition([{
                                                from : BJ_CALLSTATES.CONNECTING,
                                                to   : BJ_CALLSTATES.STARTING_MEDIA
                                            }, {
                                                from : BJ_CALLSTATES.RECONNECTING,
                                                to   : BJ_CALLSTATES.STARTING_MEDIA
                                            }]),
                establishConnection     : transition([{
                                                from : BJ_CALLSTATES.STARTING_MEDIA,
                                                to   : BJ_CALLSTATES.CONNECTED
                                            }, {
                                                from : BJ_CALLSTATES.RESTART_MEDIA,
                                                to   : BJ_CALLSTATES.CONNECTED
                                            }]),

                mediaDisruption         : transition({
                                                from: BJ_CALLSTATES.CONNECTED,
                                                to: BJ_CALLSTATES.RESTART_MEDIA,
                                                resetTriggers: true
                                            }),

                disconnect              : transition({
                                                from: _.without(_.values(BJ_CALLSTATES), BJ_CALLSTATES.DISCONNECTED),
                                                to: BJ_CALLSTATES.DISCONNECTED,
                                                resetTriggers: true
                                            }),
                reset                   : transition({
                                                from: _.without(_.values(BJ_CALLSTATES), BJ_CALLSTATES.IDLE),
                                                to: BJ_CALLSTATES.IDLE,
                                                resetTriggers: true
                                            })
            },
            triggers: [
                {event: STATE_EVTS.INITIALISE, activatedBy: allOf([SIG_STATES.HAVE_LOCAL_OFFER])},
                {event: STATE_EVTS.CONNECT, activatedBy: anyOf([ICE_G_STATES.GATHERING, ICE_G_STATES.COMPLETE])},
                {event: STATE_EVTS.START_MEDIA, activatedBy: allOf([SIG_STATES.STABLE])},
                {event: STATE_EVTS.ESTABLISH_CONNECTION, activatedBy: anyOf([ICE_C_STATES.COMPLETED, ICE_C_STATES.CONNECTED])},

                // Ice Connection state changes to "Disconnected"!!!
                {event: STATE_EVTS.MEDIA_DISRUPTION, activatedBy: allOf([ICE_C_STATES.DISCONNECTED])},

                // Nasty errors have occured, only the client can recover from this!! Needs complete call to be restarted.
                {event: STATE_EVTS.DISCONNECT, activatedBy: allOf([ICE_C_STATES.FAILED, ICE_C_STATES.CLOSED])}
            ],

            callbacks: [
                StateMachine.transitions.afterTransition({}, callStateChange)
            ]
        });
    },

    iceGatheringStateChange: function(state) {
        this.model.set('iceGatheringState', state);
        this.stateMachine.trigger('iceG_'+state);
    },

    signalingStateChange: function(state){
        this.model.set('signalingState', state);
        this.stateMachine.trigger('sig_'+state);
    },

    iceConnectionStateChange: function(state){
        this.model.set('iceConnectionState', state);
        this.stateMachine.trigger('ice_'+state);
    },

    callDisconnected: function(params) {
        this.stateMachine.disconnect();
        this._updateDisconnectState(params);
        this.model.setCurrentState(this.stateMachine.getState());
    },

    _updateDisconnectState: function(params) {
        var code = (params && params.code) || "";
        var reason = (params && params.message) || "";
        if(code) {
            code = (typeof code === "string") ? parseInt(code, 10) : code;
            this.model.set({
                'disconnectCode': code,
                'disconnectReason': {
                    'code': code,
                    'message': reason
                }
            });
        }
    },

    getCurrentCallState: function() {
        return this.model.getCurrentState();
    },

    getDisconnectReason: function() {
        return this.model.getDisconnectReason();
    },

    callStateChange: function(params) {
        if(params.to !== "disconnected")
            this.model.setCurrentState(params.to);
    },

    reset: function() {
        this.stateMachine.reset();
        this.model.setCurrentState(this.stateMachine.getState());
    }
});

module.exports = new RTCStateManager();
