import { describe, expect, it, vi } from 'vitest'
import ZwaveClient from '../../api/lib/ZwaveClient.ts'
import { socketEvents } from '../../api/lib/SocketEvents.ts'
import type { MaintenanceFinding } from '../../api/lib/Maintenance.ts'

// Mirrors the `Object.create(ZwaveClient.prototype)` pattern of
// `test/lib/ZwaveClient.test.ts`: only the fields under test are set.
// Typed as `any` because the real class keeps its fields private.
function createClient(driver: any = undefined, server: any = undefined): any {
	const client: any = Object.create(ZwaveClient.prototype)
	client._driver = driver
	client.server = server
	return client
}

function finding(): MaintenanceFinding {
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
				suggestionRows: [],
			},
		],
		verification: [],
		createdAt: 1731793200000,
		updatedAt: 1731793200000,
	}
}

function fakeSocket() {
	const emitted: { evt: string; data: any }[] = []
	return {
		emitted,
		socket: {
			to: () => ({
				emit: (evt: string, data: any) => emitted.push({ evt, data }),
			}),
		},
	}
}

const flush = () => new Promise((r) => setTimeout(r, 10))

describe('ZwaveClient maintenance findings', () => {
	it('reports no findings against an older driver (schema < 53)', () => {
		const client = createClient({ on: vi.fn() })
		expect(client.getMaintenanceFindings()).toEqual([])
	})

	it('getState() carries an empty findings list against an older driver', () => {
		const client = createClient(undefined)
		Object.defineProperty(client, 'getNodes', {
			value: () => [],
		})
		Object.defineProperty(client, 'getInfo', {
			value: () => ({}),
		})
		const state = client.getState()
		expect(state.maintenanceFindings).toEqual([])
	})

	it('forwards the three driver events to the socket', async () => {
		const { socket, emitted } = fakeSocket()
		const client = createClient({}, undefined)
		client.socket = socket

		const f = finding()
		for (const handler of [
			'_onMaintenanceFinding',
			'_onMaintenanceFindingUpdated',
			'_onMaintenanceFindingResolved',
		]) {
			client[handler](f)
		}
		await flush()

		expect(emitted).toEqual([
			{
				evt: socketEvents.maintenanceFinding,
				data: { event: 'maintenance finding', finding: f },
			},
			{
				evt: socketEvents.maintenanceFinding,
				data: { event: 'maintenance finding updated', finding: f },
			},
			{
				evt: socketEvents.maintenanceFinding,
				data: { event: 'maintenance finding resolved', finding: f },
			},
		])
	})

	it('subscribes to the events only when the driver supports them', async () => {
		const listeners: { event: string; cb: any }[] = []
		const driver = {
			on: (event: string, cb: any) => listeners.push({ event, cb }),
			getMaintenanceFindings: () => [finding()],
		}
		// emulate the subscription block in init()
		const { driverSupportsMaintenanceFindings } = await import(
			'../../api/lib/Maintenance.ts'
		)
		if (driverSupportsMaintenanceFindings(driver)) {
			for (const event of [
				'maintenance finding',
				'maintenance finding updated',
				'maintenance finding resolved',
			]) {
				driver.on(event, () => {})
			}
		}
		expect(listeners).toHaveLength(3)

		// an older driver subscribes to nothing
		const listenersOld: unknown[] = []
		const oldDriver = {
			on: (_: string, cb: unknown) => listenersOld.push(cb),
		}
		if (driverSupportsMaintenanceFindings(oldDriver)) {
			oldDriver.on('maintenance finding', () => {})
		}
		expect(listenersOld).toHaveLength(0)
	})

	it('applies a suggestion only when the driver supports it', async () => {
		const applied: { findingId: string; nodeId: number }[] = []
		const driver = {
			on: () => {},
			getMaintenanceFindings: () => [],
			applyMaintenanceSuggestion: (findingId: string, nodeId: number) => {
				applied.push({ findingId, nodeId })
				return Promise.resolve()
			},
		}
		const client = createClient(driver)
		await client.applyMaintenanceSuggestion('f1', 3)
		expect(applied).toEqual([{ findingId: 'f1', nodeId: 3 }])

		const old = createClient({ on: () => {} })
		await expect(old.applyMaintenanceSuggestion('f1', 3)).rejects.toThrow(
			/does not support maintenance findings/,
		)
	})

	it('detects an attached Home Assistant client via its user agent', () => {
		const client = createClient(
			{},
			{
				clientsController: {
					clients: [
						{ additionalUserAgentComponents: {} },
						{
							additionalUserAgentComponents: {
								'Home Assistant': '2026.11.0',
							},
						},
					],
				},
			},
		)
		expect(client.isHomeAssistantAttached()).toBe(true)

		const none = createClient(
			{},
			{
				clientsController: {
					clients: [{ additionalUserAgentComponents: { Foo: '1' } }],
				},
			},
		)
		expect(none.isHomeAssistantAttached()).toBe(false)

		// server disabled or not yet started
		const noServer = createClient({}, undefined)
		expect(noServer.isHomeAssistantAttached()).toBe(false)
	})
})
