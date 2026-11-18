import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
	MAINTENANCE_DISMISSAL_TTL_MS,
	applicableRows,
	applyRetryAvailable,
	canApply,
	dismissFinding,
	hasThresholdRows,
	isDismissed,
	nodesToApply,
	purposeLabel,
	verificationInProgress,
} from './maintenance.js'
import type {
	MaintenanceFinding,
	MaintenanceSuggestionRow,
} from '../../api/lib/Maintenance'

// ---- shared fixtures (generic device names only) ------------------

function makeRow(
	overrides: Partial<MaintenanceSuggestionRow> = {},
): MaintenanceSuggestionRow {
	return {
		parameter: 5,
		purpose: 'reporting_threshold.power',
		kind: 'threshold',
		unit: 'W',
		currentValue: 5,
		defaultValue: 5,
		proposedValue: 15,
		minValue: 5,
		maxValue: 50,
		...overrides,
	}
}

function makeFinding(
	overrides: Partial<MaintenanceFinding> = {},
): MaintenanceFinding {
	return {
		id: 'report-flood-loud-network',
		kind: 'loud-network',
		severity: 'warning',
		reason: 'A few devices send most of the network traffic',
		nodes: [
			{
				nodeId: 3,
				hourlyRate: 1420,
				shareOfInbound: 0.82,
				hasTaggedParams: true,
				suggestionRows: [
					makeRow(),
					makeRow({
						parameter: 6,
						purpose: 'reporting_interval.power',
						kind: 'interval',
						unit: 'min',
						proposedValue: 15,
						maxValue: 3600,
					}),
				],
			},
			{
				nodeId: 4,
				hourlyRate: 610,
				shareOfInbound: 0.35,
				hasTaggedParams: true,
				suggestionRows: [
					makeRow({
						parameter: 5,
						refusedReason:
							'This device reports a real load that switches between levels. Raising its threshold would hide those changes.',
					}),
				],
			},
		],
		verification: [],
		createdAt: 1731793200000,
		updatedAt: 1731793200000,
		...overrides,
	}
}

function allChecked(finding: MaintenanceFinding) {
	const checked = new Map()
	for (const node of finding.nodes) {
		for (const row of applicableRows(node)) {
			checked.set(`${node.nodeId}:${row.parameter}`, true)
		}
	}
	return checked
}

// ---- dismissals ---------------------------------------------------

describe('maintenance finding dismissals', () => {
	it('hides only the dismissed finding, not others', () => {
		const s = asStorage(new Map())
		dismissFinding(s, 'finding-a', 1000)
		expect(isDismissed(s, 'finding-a', 1001)).toBe(true)
		expect(isDismissed(s, 'finding-b', 1001)).toBe(false)
	})

	it('expires after 7 days', () => {
		const s = asStorage(new Map())
		dismissFinding(s, 'finding-a', 0)
		expect(
			isDismissed(s, 'finding-a', MAINTENANCE_DISMISSAL_TTL_MS - 1),
		).toBe(true)
		expect(isDismissed(s, 'finding-a', MAINTENANCE_DISMISSAL_TTL_MS)).toBe(
			false,
		)
	})

	it('a new dismissal of the same id restarts the window', () => {
		const s = asStorage(new Map())
		dismissFinding(s, 'f', 0)
		dismissFinding(s, 'f', MAINTENANCE_DISMISSAL_TTL_MS)
		expect(isDismissed(s, 'f', 2 * MAINTENANCE_DISMISSAL_TTL_MS - 1)).toBe(
			true,
		)
	})

	it('tolerates corrupted storage', () => {
		const s = asStorage(new Map())
		s.setItem('maintenanceFindingsDismissals', '{not json')
		expect(isDismissed(s, 'f', 0)).toBe(false)
	})
})

// helpers: Map -> localStorage-like
function asStorage(map: Map<string, string>) {
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => map.set(k, v),
	}
}

// ---- apply selection ----------------------------------------------

describe('maintenance apply selection', () => {
	it('blocked (refused) rows never take part in an apply', () => {
		const finding = makeFinding()
		// node 4 has only a refused row: it must never be applied
		const targets = nodesToApply(finding, allChecked(finding))
		expect(targets.map((n) => n.nodeId)).toEqual([3])
	})

	it('an unchecked row excludes its whole device', () => {
		const finding = makeFinding()
		const checked = allChecked(finding)
		checked.set('3:5', false) // uncheck the threshold row of node 3
		expect(nodesToApply(finding, checked)).toEqual([])
	})

	it('nodes without tagged params are never applied', () => {
		const finding = makeFinding({
			nodes: [
				{
					nodeId: 9,
					hourlyRate: 400,
					shareOfInbound: 0.5,
					hasTaggedParams: false,
					untaggedNote: 'no tagged params',
					suggestionRows: [],
				},
			],
		})
		expect(nodesToApply(finding, new Map())).toEqual([])
	})
})

// ---- gating --------------------------------------------------------

describe('maintenance apply gating', () => {
	it('threshold rows require the confirmation checkbox', () => {
		const finding = makeFinding()
		const checked = allChecked(finding)
		expect(canApply(finding, checked, false, false)).toBe(false)
		expect(canApply(finding, checked, true, false)).toBe(true)
	})

	it('interval-only rows are not gated by the checkbox', () => {
		const finding = makeFinding({
			nodes: [
				{
					nodeId: 5,
					hourlyRate: 500,
					shareOfInbound: 0.4,
					hasTaggedParams: true,
					suggestionRows: [
						makeRow({
							parameter: 6,
							purpose: 'reporting_interval.power',
							kind: 'interval',
						}),
					],
				},
			],
		})
		expect(hasThresholdRows(finding.nodes[0])).toBe(false)
		expect(canApply(finding, allChecked(finding), false, false)).toBe(true)
	})

	it('a Home Assistant client attached makes the UI read-only', () => {
		const finding = makeFinding()
		expect(canApply(finding, allChecked(finding), true, true)).toBe(false)
	})

	it('nothing selected disables apply', () => {
		const finding = makeFinding()
		expect(canApply(finding, new Map(), true, false)).toBe(false)
	})
})

// ---- retry after "not stored" -------------------------------------

describe('maintenance verification retry', () => {
	it('re-arms exactly once after a not stored verdict', () => {
		const notStored = {
			nodeId: 3,
			state: 'not stored',
			message: 'The device said OK but kept its old setting.',
			preWriteRate: 900,
			appliedAt: 1000,
			retriesLeft: 1,
		}
		expect(applyRetryAvailable([notStored])).toBe(true)

		const exhausted = { ...notStored, retriesLeft: 0 }
		expect(applyRetryAvailable([exhausted])).toBe(false)
	})

	it('no other state re-arms the button', () => {
		const states = [
			'rejected',
			'verifying',
			'verified (provisional)',
			'inconclusive (idle)',
			'stored, no effect',
			'unconfirmed',
			'regressed',
			'verified',
		]
		for (const state of states) {
			expect(
				applyRetryAvailable([
					{
						nodeId: 3,
						state,
						message: '',
						preWriteRate: 900,
						appliedAt: 1000,
						retriesLeft: 1,
					},
				]),
			).toBe(false)
			expect(
				verificationInProgress([
					{
						nodeId: 3,
						state,
						message: '',
						preWriteRate: 900,
						appliedAt: 1000,
						retriesLeft: 1,
					},
				]),
			).toBe(state === 'verifying' || state === 'inconclusive (idle)')
		}
	})
})

// ---- labels --------------------------------------------------------

describe('maintenance purpose labels', () => {
	it('labels thresholds and intervals', () => {
		expect(purposeLabel('reporting_threshold.power')).toBe(
			'Power report threshold',
		)
		expect(purposeLabel('reporting_interval.energy')).toBe(
			'Energy report interval',
		)
	})
})

// ---- fixture hygiene ----------------------------------------------

describe('no real node names in the maintenance UI slice', () => {
	// built by concatenation so this test file itself does not contain
	// the literal names either
	const forbidden = [
		['Garage', 'Computers'],
		['Gaming', 'PC Desk'],
		['Work', 'Desk'],
	].map(([a, b]) => `${a} ${b}`)

	it('components, api and tests contain no real node names', () => {
		const files: URL[] = [
			new URL('./maintenance.js', import.meta.url),
			new URL('../../api/lib/Maintenance.ts', import.meta.url),
			new URL('../../api/lib/ZwaveClient.ts', import.meta.url),
			new URL(
				'../../src/components/custom/MaintenanceAlert.vue',
				import.meta.url,
			),
			new URL(
				'../../src/components/dialogs/DialogMaintenanceFinding.vue',
				import.meta.url,
			),
			new URL(import.meta.url),
		]
		for (const url of files) {
			const content = readFileSync(url, 'utf8')
			for (const name of forbidden) {
				expect(
					content.includes(name),
					`${url.pathname} must not contain "${name}"`,
				).toBe(false)
			}
		}
	})
})
