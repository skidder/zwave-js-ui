/**
 * Maintenance (report flood) finding helpers for the browser side.
 *
 * Pure functions only so they can be unit tested in node. Nothing in
 * here talks to sockets or the driver directly.
 */

/** Dismissals expire after 7 days */
export const MAINTENANCE_DISMISSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000

const DISMISSALS_KEY = 'maintenanceFindingsDismissals'

/** localStorage-like storage (getters/setters on strings) */
function readDismissals(storage) {
	try {
		const raw = storage?.getItem(DISMISSALS_KEY)
		if (!raw) return {}
		const parsed = JSON.parse(raw)
		return typeof parsed === 'object' && parsed !== null ? parsed : {}
	} catch {
		return {}
	}
}

function writeDismissals(storage, dismissals) {
	try {
		storage?.setItem(DISMISSALS_KEY, JSON.stringify(dismissals))
	} catch {
		// storage unavailable (private mode): dismissal just won't persist
	}
}

/** Locally and durably dismiss a finding, keyed by its stable id */
export function dismissFinding(storage, findingId, now = Date.now()) {
	const dismissals = readDismissals(storage)
	dismissals[findingId] = now
	writeDismissals(storage, dismissals)
}

/**
 * Whether a finding is currently dismissed. A dismissal is keyed by the
 * finding id (not globally) and expires after 7 days.
 */
export function isDismissed(storage, findingId, now = Date.now()) {
	const dismissedAt = readDismissals(storage)[findingId]
	if (typeof dismissedAt !== 'number' || !Number.isFinite(dismissedAt)) {
		return false
	}
	return now - dismissedAt < MAINTENANCE_DISMISSAL_TTL_MS
}

/** Rows that can be written: refused rows are never offered */
export function applicableRows(node) {
	return (node?.suggestionRows ?? []).filter((row) => !row.refusedReason)
}

/** Whether a node has at least one threshold row among its offered rows */
export function hasThresholdRows(node) {
	return applicableRows(node).some((row) => row.kind === 'threshold')
}

/**
 * A node takes part in an apply only when every offered row is checked.
 * The server apply command works per device, so an unchecked row must
 * exclude the whole device - it must never be written unchecked.
 */
export function isNodeFullySelected(node, checked) {
	return (
		applicableRows(node).length > 0 &&
		applicableRows(node).every(
			(row) => checked.get(`${node.nodeId}:${row.parameter}`) === true,
		)
	)
}

/**
 * The nodes an Apply writes. Refused rows show their reason in the UI,
 * have no checkbox and never take part in an apply. Nodes without
 * tagged params have nothing to write.
 */
export function nodesToApply(finding, checked) {
	return (finding?.nodes ?? []).filter(
		(node) =>
			node.hasTaggedParams !== false &&
			applicableRows(node).length > 0 &&
			isNodeFullySelected(node, checked),
	)
}

/**
 * Whether Apply may be clicked. When no Home Assistant client is
 * attached and a device has threshold rows, the confirmation checkbox
 * "Nothing outside Z-Wave JS watches this power value" must be ticked
 * first. Interval rows are never gated this way.
 */
export function canApply(finding, checked, thresholdConfirmed, haAttached) {
	if (haAttached) return false // read-only: fix in Home Assistant instead
	if (nodesToApply(finding, checked).length === 0) return false
	if (thresholdConfirmed !== false) return true
	return !(finding?.nodes ?? []).some(
		(node) => isNodeFullySelected(node, checked) && hasThresholdRows(node),
	)
}

/**
 * Whether the Apply button is re-armed after a "not stored" verdict.
 * Exactly one retry: the driver counts `retriesLeft`, so a second
 * "not stored" leaves the button disabled for good. Any other
 * verification state in progress disables the button too.
 */
export function applyRetryAvailable(verification) {
	return (verification ?? []).some(
		(v) => v?.state === 'not stored' && v?.retriesLeft > 0,
	)
}

/**
 * Whether a verification state machine is still in progress for a node
 * (and Apply must therefore stay disabled apart from the retry case).
 */
export function verificationInProgress(verification) {
	const states = ['verifying', 'inconclusive (idle)']
	return (verification ?? []).some((v) => states.includes(v?.state))
}

/** Short human label for a reporting parameter purpose */
export function purposeLabel(purpose) {
	if (purpose?.startsWith('reporting_threshold.')) {
		return `${scaleLabel(purpose)} report threshold`
	}
	if (purpose?.startsWith('reporting_interval.')) {
		return `${scaleLabel(purpose)} report interval`
	}
	return purpose ?? ''
}

function scaleLabel(purpose) {
	const scale = purpose.split('.')[1]
	const scales = {
		power: 'Power',
		energy: 'Energy',
		current: 'Current',
		voltage: 'Voltage',
	}
	return scales[scale] ?? scale
}
