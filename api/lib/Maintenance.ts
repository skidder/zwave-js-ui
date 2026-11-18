/**
 * Maintenance (report flood) finding types shared by the Z-Wave JS UI
 * backend and the browser components.
 *
 * These mirror the payloads the zwave-js driver's report flood monitor
 * emits and the zwave-js-server forwards (schema version >= 53). The
 * payloads contain no home ID, security keys or log data.
 */

/** One writable suggestion for one configuration parameter */
export interface MaintenanceSuggestionRow {
	/** The configuration parameter number */
	parameter: number
	/** The `$purpose` the parameter is tagged with */
	purpose: string
	kind: 'threshold' | 'interval'
	/** Unit of the parameter value, as given in the config file */
	unit?: string
	/** Current value, if known */
	currentValue?: number
	defaultValue: number
	/** The value that should be written */
	proposedValue: number
	minValue: number
	maxValue: number
	/** Whether the current value is still the factory default */
	stillAtFactoryDefault?: boolean
	/** If set, this row must not be written, and the reason is shown */
	refusedReason?: string
	/** Whether the row needs a Configuration Get before it can be applied */
	needsGet?: boolean
}

/** Per-node part of a maintenance finding */
export interface MaintenanceNodeFinding {
	nodeId: number
	/** The node's inbound rate over the trailing 60 min */
	hourlyRate: number
	/** The node's share of the total inbound traffic, 0..1 */
	shareOfInbound: number
	/** Whether the device config has reporting `$purpose` tags */
	hasTaggedParams: boolean
	/** Shown when the config file has no tagged reporting parameters */
	untaggedNote?: string
	/** Suggested configuration changes for this node */
	suggestionRows: MaintenanceSuggestionRow[]
}

export type MaintenanceFindingSeverity = 'warning' | 'error'

export type MaintenanceFindingKind = 'loud-network' | 'jammed'

export type MaintenanceVerificationState =
	| 'rejected'
	| 'verifying'
	| 'verified (provisional)'
	| 'inconclusive (idle)'
	| 'not stored'
	| 'stored, no effect'
	| 'unconfirmed'
	| 'regressed'
	| 'verified'

export interface MaintenanceVerification {
	nodeId: number
	state: MaintenanceVerificationState
	/** Human-readable text describing the verification progress */
	message: string
	/** Hourly rate directly before the suggested change was applied */
	preWriteRate: number
	/** When the change was applied */
	appliedAt: number
	/** How many retries are left after a `not stored` verdict */
	retriesLeft: number
	/** Whether the cache-bypassing Get returned the new value */
	getResult?: 'old' | 'new' | 'no answer'
}

export interface MaintenanceFinding {
	/** Stable identifier of this finding */
	id: string
	kind: MaintenanceFindingKind
	severity: MaintenanceFindingSeverity
	/** Human-readable description of why this finding was raised */
	reason: string
	/** The nodes that are responsible for the finding */
	nodes: MaintenanceNodeFinding[]
	/** Verification state per node, after a suggestion was applied */
	verification: MaintenanceVerification[]
	createdAt: number
	updatedAt: number
}

/** The driver events that carry a maintenance finding */
export const maintenanceFindingEvents = [
	'maintenance finding',
	'maintenance finding updated',
	'maintenance finding resolved',
] as const

export type MaintenanceFindingEvent = (typeof maintenanceFindingEvents)[number]

/**
 * The zwave-js-server schema version that introduced the maintenance
 * finding events, state and commands. A UI running against an older
 * driver/server must show nothing and not error: because this UI embeds
 * both the driver and the server, gating on the driver actually
 * supporting the report flood monitor is the equivalent check.
 */
export const maintenanceFindingsSchemaVersion = 53

type MaintenanceDriver = {
	getMaintenanceFindings?: () => readonly MaintenanceFinding[]
	applyMaintenanceSuggestion?: (
		findingId: string,
		nodeId: number,
	) => Promise<void>
}

/**
 * Whether the connected driver supports the report flood monitor
 * (schema version >= 53). Older drivers stay silent.
 */
export function driverSupportsMaintenanceFindings(driver: unknown): boolean {
	const impl = driver as MaintenanceDriver
	return typeof impl?.getMaintenanceFindings === 'function'
}
