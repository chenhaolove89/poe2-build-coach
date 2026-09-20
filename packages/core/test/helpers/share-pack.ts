/**
 * The packer, re-exported for tests.
 *
 * It is deliberately not part of the public surface — the encoder and decoder are
 * the interface, and nothing outside this module should build a packed list — but a
 * test that wants to construct a payload by hand has to be able to produce one.
 */
export { packIds as packIdsForTest } from '../../src/share/snapshot.js'
