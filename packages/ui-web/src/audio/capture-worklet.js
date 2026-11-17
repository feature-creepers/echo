/**
 * Runs in the audio thread: hands the samples it hears to the page, a block at a time.
 * A file of its own, served with the app, because the page's security policy allows no script from elsewhere.
 */
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0]
    if (channel) this.port.postMessage(channel.slice(0))
    return true
  }
}

registerProcessor('capture', Capture)
