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

const PassThroughInterceptor = (options, nextCall) =>
  new InterceptingCall(nextCall(options), {
    start: (metadata, listener, next) => {
      next(metadata, {
        onReceiveMetadata: (metadata, next) => {
          next(metadata)
        },
        onReceiveMessage: (message, next) => {
          next(message)
        },
        onReceiveStatus: (status, next) => {
          next(status)
        }
      })
    },
    sendMessage: (message, next) => {
      next(message)
    },
    halfClose: next => {
      next()
    },
    cancel: (message, next) => {
      next()
    }
  })

const GOAWAY_RECEIVED_DETAILS = 'GOAWAY received'

const unpromisify = fn => async (...args) => {
  const [next, ...params] = [args.pop(), ...args]
  try {
    const result = await fn(...params)
    if (Array.isArray(result)) {
      next(...result)
    } else {
      next(result)
    }
  } catch (error) {
    next(error)
  }
}

class RetryInterceptingCall extends grpc.InterceptingCall {
  /**
   * Create retry intercepting call.
   *
   * @param {object} options - The grpc call options.
   * @param {number} options.maxRetries - The maximum number of retries.
   * @param {grpc.InterceptingCall} nextCall - The next call in the chain.
   */
  constructor (options, nextCall) {
    super(nextCall(options), {
      start: unpromisify((...args) => this._start(...args)),
      sendMessage: unpromisify((...args) => this._sendMessage(...args))
    })
    this._options = {
      maxRetries: 3,
      ...options
    }
    this._nextCall = nextCall
    this._savedMetadata = null
    this._savedSendMessage = null
    this._receivedMessage = null
    this._resolveMessage = null
  }
  _start (metadata) {
    this._savedMetadata = metadata
    return [
      metadata,
      {
        onReceiveMessage: unpromisify((...args) =>
          this._onReceiveMessage(...args)
        ),
        onReceiveStatus: unpromisify((...args) =>
          this._onReceiveStatus(...args)
        )
      }
    ]
  }
  _onReceiveMessage (message) {
    // Store response message.
    this._receivedMessage = message
    // Create only one pending promise.
    if (!this._resolveMessage) {
      // Return the response message, pending the response status.
      return new Promise(resolve => (this._resolveMessage = resolve))
    }
  }
  _onReceiveStatus (status, retries = 0) {
    // Assess whether the request should be retried.
    if (this._shouldRetry(status, retries)) {
      this._retry(retries)
      // Create only one pending promise.
      if (!this._resolveStatus) {
        return new Promise(resolve => (this._resolveStatus = resolve))
      }
    } else {
      this._resolveMessage(this._receivedMessage)
      if (this._resolveStatus) {
        this._resolveStatus(status)
      } else {
        return status
      }
    }
  }
  _shouldRetry (status, retries) {
    // Only retry in "unavailable, goaway" race condition circumstances.
    return (
      retries <= this._options.maxRetries &&
      status.code === grpc.status.UNAVAILABLE &&
      status.details === GOAWAY_RECEIVED_DETAILS
    )
  }
  _retry (retries) {
    retries++
    this._savedMetadata.set('retries', retries.toString())
    const newCall = this._nextCall(this._options)
    const startParams = this._start(this._savedMetadata)
    newCall.start(...startParams)
    newCall.sendMessage(this._savedSendMessage)
    newCall.halfClose()
  }
  _sendMessage (message) {
    // Store the request message so it can be resent if required.
    this._savedSendMessage = message
    return message
  }
}

const RetryInterceptor = (options, nextCall) =>
  new RetryInterceptingCall(options, nextCall)

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
        interceptors: [RetryInterceptor]
      }
    )
    this.waitForReady = promisify((...args) =>
      this.grpcClient.waitForReady(...args)
    )
    this.makeUnaryRequest = promisify((...args) =>
      this.grpcClient.makeUnaryRequest(...args)
    )
  }
  async exec (body, retries = 0) {
    try {
      console.log(`${body.seq}: Sending request`)
      const response = await this.makeUnaryRequest(
        this.path,
        this.serialize,
        this.deserialze,
        body
      )
      console.log(`${response.seq}: Received response`)
      return response
    } catch (error) {
      console.error(`${body.seq}: Error`, { error })
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
