const { promisify } = require('util')
const { setTimeout } = require('timers')
const grpc = require('grpc')
const process = require('process')

const DELAY = process.env.DELAY !== '0'
const REPEAT = 10000
const MAX_RANDOM_DELAY = 10
const MIN_RANDOM_DELAY = 1
const RETRY_LIMIT = 1
const GRPC_DNS_MIN_TIME_BETWEEN_RESOLUTIONS_MS = 0

const timeout = promisify(setTimeout)
const randomBoundedInt = (min, max) => Math.floor(Math.random() * max) + min
const randomDelay = () =>
  timeout(randomBoundedInt(MIN_RANDOM_DELAY, MAX_RANDOM_DELAY))

const GOAWAY_RECEIVED_DETAILS = 'GOAWAY received'

// https://github.com/grpc/grpc-node/blob/grpc%401.24.x/packages/grpc-native-core/test/client_interceptors_test.js#L464-L529
// var maxRetries = 3
// var retry_interceptor = function (options, nextCall) {
//   var savedMetadata
//   var savedSendMessage
//   var savedReceiveMessage
//   var savedMessageNext
//   var requester = new RequesterBuilder()
//     .withStart(function (metadata, listener, next) {
//       savedMetadata = metadata
//       var new_listener = new ListenerBuilder()
//         .withOnReceiveMessage(function (message, next) {
//           savedReceiveMessage = message
//           savedMessageNext = next
//         })
//         .withOnReceiveStatus(function (status, next) {
//           var retries = 0
//           var retry = function (message, metadata) {
//             retries++
//             var newCall = nextCall(options)
//             var receivedMessage
//             newCall.start(metadata, {
//               onReceiveMessage: function (message) {
//                 receivedMessage = message
//               },
//               onReceiveStatus: function (status) {
//                 if (status.code !== grpc.status.OK) {
//                   if (retries <= maxRetries) {
//                     retry(message, metadata)
//                   } else {
//                     savedMessageNext(receivedMessage)
//                     next(status)
//                   }
//                 } else {
//                   var new_status = new StatusBuilder()
//                     .withCode(grpc.status.OK)
//                     .build()
//                   savedMessageNext(receivedMessage)
//                   next(new_status)
//                 }
//               }
//             })
//             newCall.sendMessage(message)
//             newCall.halfClose()
//           }
//           if (status.code !== grpc.status.OK) {
//             // Change the message we're sending only for test purposes
//             // so the server will respond without error
//             var newMessage =
//               savedMetadata.get('name')[0] === 'bar'
//                 ? { value: 'bar' }
//                 : savedSendMessage
//             retry(newMessage, savedMetadata)
//           } else {
//             savedMessageNext(savedReceiveMessage)
//             next(status)
//           }
//         })
//         .build()
//       next(metadata, new_listener)
//     })
//     .withSendMessage(function (message, next) {
//       savedSendMessage = message
//       next(message)
//     })
//     .build()
//   return new InterceptingCall(nextCall(options), requester)
// }

class GoawayRetryInterceptingCall extends grpc.InterceptingCall {
  constructor (options, nextCall) {
    const { maxRetries = 3 } = options
    let savedMetadata
    let savedSendMessage
    super(nextCall(options), {
      sendMessage: (message, next) => {
        savedSendMessage = message
        next(message)
        return
      },
      start: (metadata, _, next) => {
        savedMetadata = metadata
        return next(metadata, {
          onReceiveStatus: (status, next) => {
            const retry = (message, metadata, retries = 1) => {
              metadata.set('retries', retries.toString())
              const newCall = nextCall(options)
              newCall.start(metadata, {
                onReceiveStatus: status => {
                  if (this.isRetryableStatus(status) && retries <= maxRetries) {
                    retry(message, metadata, retries++)
                    return
                  }
                  next(status)
                  return
                }
              })
              newCall.sendMessage(message)
              newCall.halfClose()
              return
            }
            if (this.isRetryableStatus(status)) {
              retry(savedSendMessage, savedMetadata)
              return
            }
            next(status)
            return
          }
        })
      }
    })
  }
  isRetryableStatus ({ code, details }) {
    switch (true) {
      case code === grpc.status.UNAVAILABLE &&
        details === GOAWAY_RECEIVED_DETAILS:
        return true
      default:
        return false
    }
  }
}

// Does nothing.
class PassthroughInterceptingCall extends grpc.InterceptingCall {
  constructor (options, nextCall) {
    super(nextCall(options), {
      start: function (metadata, listener, next) {
        next(metadata, {
          onReceiveMetadata: function (metadata, next) {
            next(metadata)
          },
          onReceiveMessage: function (message, next) {
            next(message)
          },
          onReceiveStatus: function (status, next) {
            next(status)
          }
        })
      },
      sendMessage: function (message, next) {
        next(message)
      },
      halfClose: function (next) {
        next()
      },
      cancel: function (message, next) {
        next()
      }
    })
  }
}

class Client {
  constructor (path, serialize, deserialze) {
    this.path = path
    this.serialize = serialize
    this.deserialze = deserialze
    this.retryLimit = RETRY_LIMIT
    this.grpcClient = new grpc.Client(
      process.env.SERVER_ADDRESS || 'dns:///localhost:50051',
      grpc.credentials.createInsecure(),
      {
        'grpc.dns_min_time_between_resolutions_ms': GRPC_DNS_MIN_TIME_BETWEEN_RESOLUTIONS_MS,
        'grpc.service_config': JSON.stringify({
          loadBalancingConfig: [
            {
              round_robin: {}
            }
          ]
        }),
        interceptors: [
          (options, nextCall) =>
            new GoawayRetryInterceptingCall(
              { ...options, maxRetries: 1 },
              nextCall
            )
        ]
      }
    )
    this.waitForReady = promisify((...args) =>
      this.grpcClient.waitForReady(...args)
    )
    this.makeUnaryRequest = promisify((...args) =>
      this.grpcClient.makeUnaryRequest(...args)
    )
  }
  isRetryableError (error) {
    switch (true) {
      case error.code === grpc.status.UNAVAILABLE &&
        error.details === GOAWAY_RECEIVED_DETAILS:
        return true
      default:
        return false
    }
  }
  async exec (body = {}, retries = 0) {
    try {
      const { seq } = body
      console.log(`${seq}: Sending request`)
      const response = await this.makeUnaryRequest(
        this.path,
        this.serialize,
        this.deserialze,
        body
      )
      console.log(`${seq}: Received response`)
      return response
    } catch (error) {
      const { seq } = body
      console.error(`${seq}: ${error.message}`)
      // if (this.isRetryableError(error) && retries < this.retryLimit) {
      //   return this.exec(body, retries++)
      // }
      throw error
    }
  }
  async run (repeat = REPEAT, delay = DELAY) {
    await this.waitForReady(Infinity)
    for (let seq = 0; seq < repeat; seq++) {
      const shutdown = seq === repeat - 1
      await this.exec({ seq, delay, shutdown })
      if (typeof delay === 'boolean') {
        if (delay) {
          await randomDelay()
        }
      } else if (typeof delay === 'number') {
        await timeout(delay)
      }
    }
  }
}

module.exports = {
  Client
}
