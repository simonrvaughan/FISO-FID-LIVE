/* Release315: Firebase Messaging push notifications suspended. */
self.addEventListener("install",function(){self.skipWaiting();});
self.addEventListener("activate",function(event){event.waitUntil(self.registration.unregister());});
self.addEventListener("push",function(event){event.waitUntil(Promise.resolve());});
