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

// Based on: https://github.com/grpc/grpc-node/blob/grpc%401.24.x/packages/grpc-native-core/test/client_interceptors_test.js#L464-L529
// attempted to mitigate some of the callback hell in that example.
class GoawayRetryInterceptingCall extends grpc.InterceptingCall {
  constructor (options, nextCall) {
    super(nextCall(options), {
      sendMessage: (oldMessage, next) => {
        const newMessage = this._sendMessage(oldMessage)
        next(newMessage)
      },
      start: (metadata, _, next) => {
        const listener = this._start(metadata)
        next(metadata, listener)
      }
    })
    this._options = {
      maxRetries: 3,
      ...options
    }
    this._nextCall = nextCall
    this._savedMetadata = null
    this._savedSendMessage = null
  }
  _sendMessage (message) {
    this._savedSendMessage = message
    return this._savedSendMessage
  }
  _start (metadata) {
    this._savedMetadata = metadata
    return {
      onReceiveStatus: async (oldStatus, next) => {
        try {
          const newStatus = await this._onReceiveStatus(oldStatus)
          next(newStatus)
        } catch (error) {
          next(error)
        }
      }
    }
  }
  _onReceiveStatus (status, retries = 0) {
    if (this._isRetryable(status, retries)) {
      retries++
      return this._retry(this._savedSendMessage, this._savedMetadata, retries)
    }
    return status
  }
  _isRetryable ({ code, details }, retries) {
    return (
      retries <= this._options.maxRetries &&
      code === grpc.status.UNAVAILABLE &&
      details === GOAWAY_RECEIVED_DETAILS
    )
  }
  _retry (message, metadata, retries) {
    return new Promise((resolve, reject) => {
      metadata.set('retries', retries.toString())
      const newCall = this._nextCall(this._options)
      newCall.start(metadata, {
        onReceiveStatus: async (oldStatus, next) => {
          try {
            const newStatus = await this._onReceiveStatus(oldStatus, retries)
            next(newStatus)
            return resolve(newStatus)
          } catch (error) {
            next(error)
            return reject(error)
          }
        }
      })
      newCall.sendMessage(message)
      newCall.halfClose()
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
