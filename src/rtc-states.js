var my      = require('myclass');
var Logger  = require('Logger');
var _       = require('underscore');

var RTCStates = my.Class({
    constructor: function(options) {
        this.BJ_CALLSTATES = {
            IDLE                : 'idle',
            INITIALISING        : 'initialising',
            CONNECTING          : 'connecting',
            STARTING_MEDIA      : 'starting-media',
            CONNECTED           : 'connected',
            RESTART_MEDIA       : 'restart-media',
            REINITIALISING      : 're-initialising',
            RECONNECTING        : 'reconnecting',
            DISCONNECTED        : 'disconnected'
        };

        this.WEBRTC_STATES = {
            iceGatheringState: {
                NEW: "new",
                GATHERING: "gathering",
                COMPLETE: "complete"
            },
            iceConnectionState: {
                NEW: "new",
                CHECKING: "checking",
                CONNECTED: "connected",
                COMPLETED: "completed",
                FAILED: "failed",
                DISCONNECTED: "disconnected",
                CLOSED: "closed"
            },
            signalingState: {
                STABLE: "stable",
                HAVE_LOCAL_OFFER: "have-local-offer",
                HAVE_REMOTE_OFFER: "have-remote-offer",
                HAVE_LOCAL_PRANSWER: "have-local-pranswer",
                HAVE_REMOTE_PRANSWER: "have-remote-pranswer",
                CLOSED: "closed"
            }
        };

        this.STATE_EVENTS = {
            INITIALISE              : 'initialise',
            CONNECT                 : 'connect',
            START_MEDIA             : 'startMedia',
            ESTABLISH_CONNECTION    : 'establishConnection',
            MEDIA_DISRUPTION        : 'mediaDisruption',
            //FAILED_CONNECTION       : 'failedConnection',
            DISCONNECT              : 'disconnect',
            RESET                   : 'reset'
        };

        this.TRANSACTION_STATES = {
            INIT: 'init',
            RESEND: 'resend',
            FAILED: 'failed',
            FINISHED: 'finished',
            ERROR: 'error'
        };

        this.EXTENSION_STATES = {
            NOT_INSTALLED                   : 'not_installed',
            INSTALLING                      : 'installing',
            BG_SCRIPTS_INJECTED             : 'background_scripts_injected',
            INSTALLED                       : 'installed',
            IFRAME_INSTALL_FAILED           : 'iframe_install_failed', // occurs when inline install is tried from skinny embedded in iframe
            INSTALL_FAILED_DOMAIN_UNVERIFIED : 'install_failed_domain_not_verified', // occurs when extension is verfied for xyz.com but installing from abc.com
            INSTALL_FAILED                  : 'install_failed',
            INSTALL_CANCELLED               : 'install_cancelled',
            REQUEST_FAILED                  : 'request_failed'
        };

        this.WS_STATES = {
            CONNECTED           : "connected",
            RECONNECTED         : "reconnected",
            DISCONNECTED        : "disconnected",
            FAILED              : "failed",
            CLOSED              : "closed"
        };

        this.WS_STATES = {
            CONNECTED           : "connected",
            RECONNECTED         : "reconnected",
            DISCONNECTED        : "disconnected",
            FAILED              : "failed",
            CLOSED              : "closed"
        };
    },

    addWebrtcStatePrefix: function(prefix, states) {
        var prefixStates = {};
        _.forEach(states, function(value, key){
            prefixStates[key] = prefix + value;
        });
        return prefixStates;
    }

});

module.exports = new RTCStates();
