const _ = require('underscore');
const my = require('myclass');
const browserDetector = require('browserDetector');

var mediaController;

var CONSOLE_COLUMNS_DATA = {
    'windows': {
        'chrome': [
            { screenWidth: 1920, columns: 267 },
            { screenWidth: 1080, columns: 147 }],
        'firefox':[
            { screenWidth: 1920, columns: 271 },
            { screenWidth: 1080, columns: 151 }],
        'opera':  [
            { screenWidth: 1920, columns: 315 },
            { screenWidth: 1080, columns: 175 }],
        'ie':     [
            { screenWidth: 1920, columns: 270 },
            { screenWidth: 1080, columns: 149 }]
    },
    'mac': {
        'chrome': [
            { screenWidth: 1280, columns: 176 },
            { screenWidth: 1024, columns: 139 }],
        'firefox': [
            { screenWidth: 1280, columns: 190 },
            { screenWidth: 1024, columns: 151 }],
        'safari': [
            { screenWidth: 1280, columns: 135 },
            { screenWidth: 1024, columns:  99 }]
    }
};

var CONSOLE_SUFFIX_LENGTH = {
    'chrome': ' skinny.js:12345'.length,
    'firefox': 'skinny.js?7211GG0 (line 12345)'.length,
    'opera': 'skinny.js:12345'.length,
    'safari': 'skinny.js:12345'.length,
    'ie': "LOG: ".length
};

var LogLevel = {
    ALL   : { func : null, include    : function(value) { return (/all/i).test(value); }, exclude     : null },
    ERROR : { func : "error", include : function(value) { return (/\+error/i).test(value); }, exclude : function(value) { return (/\-error/i).test(value); } },
    WARN  : { func : "warn", include  : function(value) { return (/\+warn/i).test(value); }, exclude  : function(value) { return (/\-warn/i).test(value); } },
    INFO  : { func : "info", include  : function(value) { return (/\+info/i).test(value); }, exclude  : function(value) { return (/\-info/i).test(value); } },
    LOG   : { func : "log", include   : function(value) { return (/\+log/i).test(value); }, exclude   : function(value) { return (/\-log/i).test(value); } },
    DEBUG : { func : "debug", include : function(value) { return (/\+debug/i).test(value); }, exclude : function(value) { return (/\-debug/i).test(value); } }
};

var allLogLevels = ['debug', 'log', 'info', 'warn', 'error'];
var Logger = my.Class({
    STATIC: {
        TIME_FORMAT: 'hh:mm:ss.SSSS'
    },

    constructor : function() {
        _.bindAll(this);
    },

    getCurrentLogLevel: function(){
        var controlLevel = this.controlLevel();
        var controlLevelIndex = _(allLogLevels).indexOf(controlLevel);
        var levels = controlLevelIndex >= 0 ? _(allLogLevels).first(controlLevelIndex) : allLogLevels;
        return ['all'].concat(levels.join('-')).join('-');
    },

    log: function(/* varargs */) {
        this._log(arguments, LogLevel.LOG);
    },

    debug: function(/* varargs */) {
        this._log(arguments, LogLevel.DEBUG);
    },

    info: function(/* varargs */) {
        this._log(arguments, LogLevel.INFO);
    },

    warn: function(/* varargs */) {
        this._log(arguments, LogLevel.WARN);
    },

    error: function(/* varargs */) {
        this._log(arguments, LogLevel.ERROR);
    },

    isLevel: function(level) {
        return new RegExp("level="+level,"i").test(window.location.search);
    },

    controlLevel: function() {
        var _me = this;
        return _.find(allLogLevels, function(level) {
            return _me.isLevel(level);
        });
    },

    _log: function(messages, level) {
        try {

            var now = new Date();
            var timestamp = ("0"+now.getHours()).substr(-2)+":"+("0"+now.getMinutes()).substr(-2)+":"+("0"+now.getSeconds()).substr(-2)+"."+("000"+now.getMilliseconds()).substr(-4);

            messages[0] = "[" + timestamp + "](" + level.func.toUpperCase() + "): " + messages[0];

            if (window.console && window.console.log) {
                window.location.search.match(/log=debug/);
                var currentLogLevel = this.getCurrentLogLevel();
                if ((LogLevel.ALL.include(currentLogLevel) && !level.exclude(currentLogLevel)) || level.include(currentLogLevel)) {

                    if(typeof window.console[level.func] == 'function'){
                        window.console[level.func].apply(window.console, messages);
                    } else {
                        window.console[level.func](_(messages).toArray().join(", "));
                    }
                }
            }
        } catch(e) {
            console.log(e.stack);
        }
        // });
    },

    pluginLog: function(level, filename, line, message) {
        // if(!mediaController){
        //     require(['mediaController'], function(_mediaController){
        //         mediaController = _mediaController;
        //     });
        // }
        try {
            var pluginLogMessages = [];
            pluginLogMessages[0] = level.toUpperCase() + '  ♦ ' + '[' + filename + ':' + line + ']' + message[0].replace(/\s+\(/g, ' (');
            if (mediaController) {
                mediaController.pluginLog(pluginLogMessages);
            }
        } catch (err) {
            // Don't do anything
        }
    },

    /**
     * Log levels can be enabled and disabled with meetingParams.LOG_LEVEL, which is
     *   populated by Rivet and the ?log query paramter
     * @param levelName {String} a log level name, such as 'info', 'debug', 'log',
     *   'error', 'warn'
     * @return {Boolean} true if logging to the given level is allowed, false otherwise
     *
     * example: Logger.check('error') => true
     */
    check: function(levelName){
        var level = LogLevel[levelName.toUpperCase()];
        var control = this.controlLevel();
        if(level){
            return (LogLevel.ALL.include(control) && !level.exclude(control)) ||
                level.include(control);
        } else {
            return false; //invalid level
        }
    },

    /**
     * Log the given vararg messages to the plugin
     * Returns the arguments array that should be passed to console.*
     * Messages will be logged irrespective of the allowed logging levels
     *   (use Logger.check(level) for that)
     */
    prepare: function(level, filename, line, messageArgs){
        var messages = _(messageArgs).toArray();
        level = level.toUpperCase();

        var timestamp = (new moment()).format(Logger.TIME_FORMAT);
        messages[0] = timestamp + ' @ ' + (level+'  ').substr(0, 5) + " \u2666 " + messages[0];

        var filenameAndLineNumberString = "("+filename + ":" + ('0000'+line).substr(-Math.max(String(line).length, 3))+")";

        if(messages.length > 1){
            messages.push(filenameAndLineNumberString);
        } else {
            var messageLength = messages[0].length;
            var paddingLength = Math.max(1, this.getConsoleColumns() - CONSOLE_SUFFIX_LENGTH[browserDetector.browser] - messageLength - filenameAndLineNumberString.length - 1);
            paddingLength = isNaN(paddingLength) ? 1 : paddingLength;
            var paddingStr = (new Array(paddingLength+1)).join(' ');

            messages[0] += paddingStr + filenameAndLineNumberString;
        }

        return messages;
    },

    getCurrentTime: function(format) {
        var now = new Date();
        var currentTime = "";
        switch(format) {
            case 'hh:mm:ss.SSSS':
                currentTime = now.getHours() + ':' + now.getMinutes() + ':' + now.getSeconds() + '.' + now.getMilliseconds();
                break;
            default:
                console.error("Invalid time format passed for log formatting");
        }
        return currentTime;
    },

    getConsoleColumns: function(){
        var browser = browserDetector.browser;
        var os = browserDetector.os;

        var dataPoints = CONSOLE_COLUMNS_DATA[os] && CONSOLE_COLUMNS_DATA[os][browser] ?
            CONSOLE_COLUMNS_DATA[os][browser] : 0;
        var windowWidth = window.innerWidth;
        var slope, columnsAtZeroWidthWindow;
        if (dataPoints) {
            slope = (dataPoints[0].columns - dataPoints[1].columns) / (dataPoints[0].screenWidth - dataPoints[1].screenWidth);
            columnsAtZeroWidthWindow = dataPoints[0].columns - slope*dataPoints[0].screenWidth;
        } else {
            slope = 0;
            columnsAtZeroWidthWindow = 0;
        }
        return Math.floor(slope * windowWidth + columnsAtZeroWidthWindow);
    }
});

module.exports = new Logger();
