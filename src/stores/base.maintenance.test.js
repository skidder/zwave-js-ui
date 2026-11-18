import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// base.js (and colorScheme.js) touch `window` and `localStorage` at import
// time - stub both before the dynamic import below
vi.stubGlobal('window', {
	localStorage: {
		getItem: () => null,
		setItem: () => {},
		removeItem: () => {},
	},
	matchMedia: () => ({
		matches: false,
		addEventListener: () => {},
		removeEventListener: () => {},
	}),
})
vi.stubGlobal('localStorage', {
	getItem: () => null,
	setItem: () => {},
	removeItem: () => {},
})

// imported lazily so the stubs above are in place first
const getStore = async () => (await import('./base')).default()

function finding(id, overrides = {}) {
	return {
		id,
		kind: 'loud-network',
		severity: 'warning',
		reason: 'A few devices send most of the network traffic',
		nodes: [
			{
				nodeId: 3,
				hourlyRate: 1420,
				shareOfInbound: 0.82,
				hasTaggedParams: true,
				suggestionRows: [],
			},
		],
		verification: [],
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	}
}

describe('store maintenance findings', () => {
	let store

	beforeEach(async () => {
		setActivePinia(createPinia())
		store = await getStore()
	})

	it('starts empty', () => {
		expect(store.maintenanceFindings).toEqual([])
	})

	it('seeds from the initial state; an older server (no field) is a no-op', () => {
		store.initMaintenanceFindings([finding('f1')])
		expect(store.maintenanceFindings).toHaveLength(1)

		// an older server does not send the field at all
		store.initMaintenanceFindings(undefined)
		expect(store.maintenanceFindings).toHaveLength(1)

		store.initMaintenanceFindings([])
		expect(store.maintenanceFindings).toEqual([])
	})

	it('wires events: new findings upsert, updates replace, resolved removes', () => {
		store.onMaintenanceFinding({
			event: 'maintenance finding',
			finding: finding('f1'),
		})
		expect(store.maintenanceFindings).toHaveLength(1)

		const updated = finding('f1', {
			verification: [
				{
					nodeId: 3,
					state: 'verifying',
					message: 'Checking traffic…',
					preWriteRate: 900,
					appliedAt: 1000,
					retriesLeft: 1,
				},
			],
		})
		store.onMaintenanceFinding({
			event: 'maintenance finding updated',
			finding: updated,
		})
		expect(store.maintenanceFindings).toHaveLength(1)
		expect(store.maintenanceFindings[0].verification).toHaveLength(1)

		// a second finding coexists
		store.onMaintenanceFinding({
			event: 'maintenance finding',
			finding: finding('f2'),
		})
		expect(store.maintenanceFindings).toHaveLength(2)

		store.onMaintenanceFinding({
			event: 'maintenance finding resolved',
			finding: finding('f2'),
		})
		expect(store.maintenanceFindings.map((f) => f.id)).toEqual(['f1'])
	})

	it('resolution of the last finding dismisses the card state', () => {
		store.onMaintenanceFinding({
			event: 'maintenance finding',
			finding: finding('f1'),
		})
		store.onMaintenanceFinding({
			event: 'maintenance finding resolved',
			finding: finding('f1'),
		})
		expect(store.maintenanceFindings).toEqual([])
	})

	it('ignores malformed events without erroring', () => {
		store.onMaintenanceFinding(undefined)
		store.onMaintenanceFinding({ event: 'maintenance finding' })
		store.onMaintenanceFinding({
			event: 'maintenance finding',
			finding: { noId: true },
		})
		expect(store.maintenanceFindings).toEqual([])
	})
})
