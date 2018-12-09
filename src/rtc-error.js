var my      = require('myclass');
var Logger  = require('Logger');
var Q       = require('q');

var RTCErrors = my.Class({

    constructor: function(options) {

        /* Errors specific to the BlueJay Signaling protocol */
        this.SIGNALING_ERRORS = {
            BAD_REQUEST         : {code: '400', message: 'Bad Request'},
            DOESNOT_EXIST       : {code: '481', message: 'Call Does Not Exists'},
            NOT_ALLOWED         : {code: '405', message: 'Method Not Allowed'},
            METHOD_NOT_IMPLEMENTED : {code: '501', message: 'Method Not Implemented'}
        };

        /* Errors specific to call disconnect scenarios */
        this.DISCONNECT_REASONS = {
            REQ_TIMED_OUT       : {code: '408', message: 'Request Timeout'},
            TRANSPORT_FAIL      : {code: '500', message: 'Server Internal Error'},
            KEEPALIVE_TIMEOUT   : {code: '450', message: 'Keep Alive Timeout'},
            USER_INITIATED      : {code: '200', message: 'User Action'},
            NODE_DRAIN          : {code: '302', message: 'Node Draining'},
            SERVICE_UNAVAILABLE : {code: '503', message: 'Service Unavailable'},
            ICE_CONNECTION_FAILED   : {code: '520', message: 'Ice Connection Failed'},
            ICE_GATHERING_FAILED    : {code: '521', message: 'Ice Gathering Failed'},
            SIG_CHANNEL_CLOSED      : {code: '522', message: 'Signaling Channel Closed'}
        };

        /* States for getUserMedia call */
        this.GET_LOCAL_MEDIA_STATES = {
            AVAILABLE           : {code: 200, message: 'Requested devices are available', details: ''},
            DEVICES_NOT_FOUND   : {code: 404, message: 'Requested devices were not found', details: ''},
            PERMISSION_DENIED   : {code: 401, message: 'User denied access to local device streams', details: ''},
            SOURCE_UNAVAILABLE  : {code: 423, message: 'Device is unavailable, maybe locked by another process', details: ''},
            NOT_READABLE        : {code: 409, message: 'Device source in use', details: ''},
            EXCEPTION           : {code: 500, message: 'Unknown error', details: ''}
        };

        /* STATES for Screen Sharing feature */
        this.SCREEN_SHARING_STATES = {
            STARTED                         : {code: 200, message: 'Screen Sharing has started', details: ''},
            INSTALL_EXTENSION_FAILED        : {code: 421, message: 'Chrome Extension installation failed', details: ''},
            GET_TOKEN_FAILED                : {code: 408, message: 'Token request timed out', details: ''},
            GET_SCREEN_MEDIA_FAILED         : {code: 400, message: 'Failed to get screen media stream', details: ''},
            EXCEPTION                       : {code: 500, message: 'Unknown error', details: ''},
            STOPPED                         : {code: 204, message: 'Screen Sharing has stopped', details: ''}
        };

        this.PEER_CONNECTION_ERRORS = {
            PC_CLOSED          : {code: 410, message: 'Peer Connection is closed, request cannot be processed', details: ''}
        };
    },

    translateGetUserMediaError: function(error) {
        var translatedError = {};
        var gumErrors = this.GET_LOCAL_MEDIA_STATES;

        switch(error.name) {
            case "DevicesNotFoundError": translatedError = gumErrors.DEVICES_NOT_FOUND; break;

            case "PermissionDeniedError": translatedError = gumErrors.PERMISSION_DENIED; break;

            case "SourceUnavailableError": translatedError = gumErrors.SOURCE_UNAVAILABLE; break;

            case "NotReadableError": translatedError = gumErrors.NOT_READABLE; break;

            default: Logger.warn('Unhandled error in getUserMedia: ', error); translatedError = gumErrors.EXCEPTION;
        }
        translatedError.details = error; // add the actual error retuned by api in 'details' field
        return translatedError;
    },

    //Temp Workaround for Chrome: If camera is not avaliable, bubble up a fake SourceUnavailableError until this error gets implemented in chrome
    detectCameraStatus: function(stream) {
        /*
        var deferred = Q.defer();
        var cameraAvailable = false;
        var cameraError, videoTrack, self = this;
        if(stream && typeof(stream.getVideoTracks) === 'function') {
            videoTrack = stream.getVideoTracks()[0];
            if(videoTrack) {
                window.setTimeout(function() {
                    if(videoTrack.readyState === 'ended') {
                        cameraAvailable = false;
                        Logger.warn('RTCErrors: Camera feed is unavailable, faulty camera or its in use by another program');
                        deferred.resolve(self.GET_LOCAL_MEDIA_STATES.SOURCE_UNAVAILABLE);
                    } else {
                        cameraAvailable = true;
                        deferred.resolve(self.GET_LOCAL_MEDIA_STATES.AVAILABLE);
                    }
                }, 0);
            } else {
                deferred.resolve(this.GET_LOCAL_MEDIA_STATES.SOURCE_UNAVAILABLE);
            }
        } else {
            deferred.resolve(this.GET_LOCAL_MEDIA_STATES.DEVICES_NOT_FOUND);
        }
        return deferred.promise;
        */
        var cameraAvailable = false;
        var cameraError, videoTrack, self = this;
        if(stream && typeof(stream.getVideoTracks) === 'function') {
            videoTrack = stream.getVideoTracks()[0];
            if(videoTrack) {
                    if(videoTrack.readyState === 'ended') {
                        cameraAvailable = false;
                        Logger.warn('RTCErrors: Camera feed is unavailable, faulty camera or its in use by another program');
                        return self.GET_LOCAL_MEDIA_STATES.SOURCE_UNAVAILABLE;
                    } else {
                        cameraAvailable = true;
                        return self.GET_LOCAL_MEDIA_STATES.AVAILABLE;
                    }
            } else {
                Logger.warn('RTCErrors: No video tracks available in the stream, triggering camera unavailable state');
                return this.GET_LOCAL_MEDIA_STATES.SOURCE_UNAVAILABLE;
            }
        } else {
            return this.GET_LOCAL_MEDIA_STATES.DEVICES_NOT_FOUND;
        }
    }

});

module.exports = new RTCErrors();
