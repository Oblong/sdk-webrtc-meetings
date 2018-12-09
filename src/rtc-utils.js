var $ 					= require('jquery');
var Q 					= require('q');
var my   				= require('myclass');
var _       		= require('underscore');
var Logger      = require('Logger');

var RTCUtils = my.Class({

  constructor: function() {
  },

  promiseDecorator: function(func) {
    return function() {
      var deferred = Q.defer();
      func.apply(this, arguments);
      deferred.resolve();
      return deferred.promise;
    }
  },

  deepMergeObjects: function(objectA, objectB) {
    objectA = typeof objectA === 'object' ? objectA : {};
    objectB = typeof objectB === 'object' ? objectB : {};
    var keysA = _.keys(objectA), keysB = _.keys(objectB);
    var result = _.extend({}, objectA);
    var type = Object.prototype.toString;

    _.each(keysB, function(key, index, list) {

      if(_.indexOf(keysA, key) === -1) {
        result[key] = objectB[key];
      } else {
        var valueA = objectA[key];
        var valueB = objectB[key];

        if(type.call(valueA) !== type.call(valueB)) {
          result[key] = objectB[key];
        } else if(type.call(valueA) === '[object Object]') {
          result[key] = this.deepMergeObjects(valueA, valueB);
        } else if(type.call(valueA) === '[object Array]') {
          result[key] = this.deepMergeArrays(valueA, valueB);
        } else {
          result[key] = objectB[key];
        }
      }

    }, this);

    return result;
  },

  deepMergeArrays: function(arrayA, arrayB) {
    var result = arrayA;
    var type = Object.prototype.toString;

    _.each(arrayB, function(valueB, indexB, listB) {

      if(type.call(valueB) !== '[object Object]') {
        result.push(valueB);
      } else {
        var keysA, keysB, diffKeys;
        var matchFound = false;

        keysB = _.keys(valueB);

        _.each(arrayA, function(valueA, indexA, listA) {
          if(type.call(valueA) === '[object Object]') {
            keysA = _.keys(valueA);
            diffKeys = _.difference(keysA, keysB);
            if(!diffKeys.length) {
              result[indexA] = this.deepMergeObjects(valueA, valueB);
              matchFound = true;
            }
          }
        }, this);
        if(!matchFound) {
          result.push(valueB);
        }
      }

    }, this);

    return result;
  },

  getLocalStreamType: function(stream) {
          var streamType;

          switch(stream.bjn_label){
              case "local_audio_stream":
                  streamType = 'localAudioStream';
              break;
              case "local_video_stream":
                  streamType = 'localVideoStream';
              break;
              case "preview_stream":
                streamType = 'previewStream';
              break;
              case "content_stream":
                  streamType = 'localContentStream';
              break;
              case "fake_stream":
                  streamType = 'fakeStream';
                  break;
              default:
                  Logger.error('RTCUtils: Unknown stream type. Stream label: ' + stream.bjn_label);
          }
          return streamType;
      },

      getRemoteStreamType: function(stream) {
          return (stream.id === 'stream_label') ? 'remoteStream' : 'remoteContentStream';
      }

});

module.exports = new RTCUtils();
