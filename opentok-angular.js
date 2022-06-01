/*!
 *  opentok-angular (https://github.com/aullman/OpenTok-Angular)
 *
 *  Angular module for OpenTok
 *
 *  @Author: Adam Ullman (http://github.com/aullman)
 *  @Copyright (c) 2014 Adam Ullman
 *  @License: Released under the MIT license (http://opensource.org/licenses/MIT)
 **/

if (!window.OT) throw new Error('You must include the OT library before the OT_Angular library');

var ng;
if (typeof angular === 'undefined' && typeof require !== 'undefined') {
  ng = require('angular');
} else {
  ng = angular;
}
var initLayoutContainer;
if (!window.hasOwnProperty('initLayoutContainer') && typeof require !== 'undefined') {
  initLayoutContainer = require('opentok-layout-js').initLayoutContainer;
} else {
  initLayoutContainer = window.initLayoutContainer;
}

ng.module('opentok', [])
  .factory('OT', function () {
    return OT;
  })
  .factory('OTSession', ['OT', '$rootScope',
    function (OT, $rootScope) {
      var OTSession = {
        streams: [],
        connections: [],
        publishers: [],

        init: function (apiKey, sessionId, token, cb) {
          this.session = OT.initSession(apiKey, sessionId, {
            iceConfig: {
              includeServers: 'custom',
              transportPolicy: 'all',
              customServers: [
                {
                  urls: [
                    'stun:ip-34-228-34-29.proxy.dev.tokbox.com:3478',
                  ],
                },
              ],
            },
          });

          OTSession.session.on({
            sessionConnected: function () {
              OTSession.publishers.forEach(function (publisher) {
                OTSession.session.publish(publisher, function (err) {
                  if (err) {
                    $rootScope.$broadcast('otPublisherError', err, publisher);
                  }
                });
              });
            },
            streamCreated: function (event) {
              $rootScope.$apply(function () {
                OTSession.streams.push(event.stream);
              });
            },
            streamDestroyed: function (event) {
              $rootScope.$apply(function () {
                OTSession.streams.splice(OTSession.streams.indexOf(event.stream), 1);
              });
            },
            sessionDisconnected: function () {
              $rootScope.$apply(function () {
                OTSession.streams.splice(0, OTSession.streams.length);
                OTSession.connections.splice(0, OTSession.connections.length);
              });
            },
            connectionCreated: function (event) {
              $rootScope.$apply(function () {
                OTSession.connections.push(event.connection);
              });
            },
            connectionDestroyed: function (event) {
              $rootScope.$apply(function () {
                OTSession.connections.splice(OTSession.connections.indexOf(event.connection), 1);
              });
            }
          });

          this.session.connect(token, function (err) {
            if (cb) cb(err, OTSession.session);
          });
          this.trigger('init');
        },
        addPublisher: function (publisher) {
          this.publishers.push(publisher);
          this.trigger('otPublisherAdded');
        }
      };
      OT.$.eventing(OTSession);
      return OTSession;
    }
  ])
  .directive('otLayout', ['$window', '$parse', 'OT', 'OTSession',
    function ($window, $parse, OT, OTSession) {
      return {
        restrict: 'E',
        scope: {
          props: '&'
        },
        link: function (scope, element, attrs) {
          var layout = function () {
            var props = scope.props() || {};
            var container = initLayoutContainer(element[0], props);
            container.layout();
            scope.$emit('otLayoutComplete');
          };
          scope.$watch(function () {
            return element.children().length;
          }, layout);
          $window.addEventListener('resize', layout);
          scope.$on('otLayout', layout);
          var listenForStreamChange = function listenForStreamChange() {
            OTSession.session.on('streamPropertyChanged', function (event) {
              if (event.changedProperty === 'videoDimensions') {
                layout();
              }
            });
          };
          if (OTSession.session) listenForStreamChange();
          else OTSession.on('init', listenForStreamChange);
        }
      };
    }
  ])
  .directive('otPublisher', ['OTSession', '$rootScope',
    function (OTSession, $rootScope) {
      return {
        restrict: 'E',
        scope: {
          props: '&'
        },
        link: function (scope, element, attrs) {
          var props = scope.props() || {};
          props.width = props.width ? props.width : ng.element(element).width();
          props.height = props.height ? props.height : ng.element(element).height();
          var oldChildren = ng.element(element).children();
          var publisherVideo;
          var canvas;
          var interval;

          if (props.videoSource === 'screenCanvas') {
            // Default values: HD at 15fps
            const width = props.screenwidth || 1280;
            const height = props.screenheight || 720;
            const framerate = props.framerate || 30;
            props.videoContentHint = 'detail';
            publisherVideo = document.createElement('video');
            navigator.mediaDevices.getDisplayMedia({ video: { width, height }, audio: false }).then((stream) => {
              stream.getTracks().forEach((track) => {
                track.addEventListener('ended', () => {
                  if (scope.publisher) {
                    scope.publisher.destroy();
                  }
                  publisherVideo = null;
                  canvas = null;
                  if (interval) {
                    clearInterval(interval)
                  }
                });
              });
              publisherVideo.srcObject = stream;
            }).catch(error => scope.$emit('otPublisherError', error, { id: 'screenPublisher' }));
            publisherVideo.play();
            canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            interval = setInterval(() => {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(publisherVideo, 0, 0);
            }, 1000 / framerate);
            props.videoSource = canvas.captureStream(framerate).getVideoTracks()[0];
          }

          scope.publisher = OT.initPublisher(attrs.apikey || OTSession.session.apiKey,
            element[0], props, function (err) {
              if (err) {
                scope.$emit('otPublisherError', err, scope.publisher);
              }
            });
          // Make transcluding work manually by putting the children back in there
          ng.element(element).append(oldChildren);
          scope.publisher.on({
            accessDenied: function () {
              scope.$emit('otAccessDenied');
            },
            accessDialogOpened: function () {
              scope.$emit('otAccessDialogOpened');
            },
            accessDialogClosed: function () {
              scope.$emit('otAccessDialogClosed');
            },
            accessAllowed: function () {
              ng.element(element).addClass('allowed');
              scope.$emit('otAccessAllowed');
            },
            loaded: function () {
              $rootScope.$broadcast('otLayout');
            },
            streamCreated: function (event) {
              scope.$emit('otStreamCreated', event);
            },
            streamDestroyed: function (event) {
              scope.$emit('otStreamDestroyed', event);
            },
            videoElementCreated: function (event) {
              event.element.addEventListener('resize', function () {
                $rootScope.$broadcast('otLayout');
              });
            }
          });
          scope.$on('$destroy', function () {
            if (OTSession.session) OTSession.session.unpublish(scope.publisher);
            else scope.publisher.destroy();
            OTSession.publishers = OTSession.publishers.filter(function (publisher) {
              return publisher !== scope.publisher;
            });
            scope.publisher = null;
            if (interval) {
              clearInterval(interval);
              publisherVideo = null;
              canvas = null;
            }
          });
          if (OTSession.session && (OTSession.session.connected ||
            (OTSession.session.isConnected && OTSession.session.isConnected()))) {
            OTSession.session.publish(scope.publisher, function (err) {
              if (err) {
                scope.$emit('otPublisherError', err, scope.publisher);
              }
            });
          }
          OTSession.addPublisher(scope.publisher);
        }
      };
    }
  ])
  .directive('otSubscriber', ['OTSession', '$rootScope',
    function (OTSession, $rootScope) {
      return {
        restrict: 'E',
        scope: {
          stream: '=',
          props: '&'
        },
        link: function (scope, element) {
          var stream = scope.stream,
            props = scope.props() || {};
          props.width = props.width ? props.width : ng.element(element).width();
          props.height = props.height ? props.height : ng.element(element).height();
          var oldChildren = ng.element(element).children();
          var subscriber = OTSession.session.subscribe(stream, element[0], props, function (err) {
            if (err) {
              scope.$emit('otSubscriberError', err, subscriber);
            }
          });
          // let namesByConnectionId = {}

          // const getNameFromConnection = (connection) => {
          //   let id = connection.creationTime.toString();
          //   id = id.substring(id.length - 6, id.length - 1);
          //   return `Guest${id}`;
          // };

          // const getName = (from) => {
          //   if (!namesByConnectionId[from.connectionId]) {
          //     namesByConnectionId[from.connectionId] = getNameFromConnection(from);
          //   }
          //   return namesByConnectionId[from.connectionId];
          // };

          OTSession.session.on('signal:name', (event) => {
            namesByConnectionId[event.from.connectionId] = event.data;
            scope.$apply();
          });

          subscriber.on({
            loaded: function () {
              $rootScope.$broadcast('otLayout');
            },
            videoElementCreated: function (event) {
              event.element.addEventListener('resize', function () {
                $rootScope.$broadcast('otLayout');
              });
              // TODO ADD A BUTTON
              subscriber.subscribeToCaptions(true);
            },
            // captionsReceived: function(event) {
            //   const captionBox = document.getElementById('caption-render-box');
            //   const name = getName(subscriber.stream.connection);
            //   captionBox.innerText = `${name}: ${event.caption}`;
            // }
          });
          // Make transcluding work manually by putting the children back in there
          ng.element(element).append(oldChildren);
          scope.$on('$destroy', function () {
            OTSession.session.unsubscribe(subscriber);
          });
        }
      };
    }
  ]);

  // Maybe this should be an object
  const captionSubscriberTracker = () => {
    const MAX_SUBS_ON_SCREEN = 5;
    const CAPTIONS_TIMEOUT = 5 * 100;

    const captionBox = document.getElementById('caption-render-box');

    let namesByConnectionId = {};
    const getNameFromConnection = (connection) => {
      let id = connection.creationTime.toString();
      id = id.substring(id.length - 6, id.length - 1);
      return `Guest${id}`;
    };
    const getName = (from) => {
      if (!namesByConnectionId[from.connectionId]) {
        namesByConnectionId[from.connectionId] = getNameFromConnection(from);
      }
      return namesByConnectionId[from.connectionId];
    };
  
    // let's have an ordered array of objects 
    // we will then interate over the array

    // Should the array elements be objects?
    // We will need a timeout running for each active subscriber I think

    // we should remove the last element of the array if it exceeds the size
    let captionsArray = []
    // the object should have a shape {caption, streamId, timeout, name}

    // This function should be called by handleCaptionsEvent
    const renderCaptionsArray = () => {
      let captionString = ''
      captionsArray.forEach((captionElm) => {
        captionString = `${captionString} \n ${captionElm.name}: ${captionElm.caption}`
        captionBox.innerText = captionString;
      })
    }

    const alreadyHasStream = (streamId) => {
      return !!captionsArray.filter((elm) => elm.streamId === streamId);
    }

    // this function should just clear the timer and remove from the array, nothing else
    const clearElementWithStreamId = (streamId) => {
      
    }
    const handleCaptionsEvent = (captionEvent,subscriber) => {
      // if the streamId is already represented we push to the top and reset the timer
      // otherwise we push this to the top and pop out and the last element and stop it's timer

      const name = getName(subscriber.stream.connection);

      // have to check if the array contains the streamID already
      if (alreadyHasStream(captionEvent.streamId)){
        // we need to find the existing element and move it to the front and update the timeout

        renderCaptionsArray();
        return;
      }
      // let's add the array plus the timer




      if (captionsArray.length > MAX_SUBS_ON_SCREEN) {
        // pop the last element and clear its timer
      }
      renderCaptionsArray();
    }





  }