<template>
	<div v-if="visibleFindings.length > 0">
		<v-alert
			v-for="finding in visibleFindings"
			:key="finding.id"
			max-width="600px"
			density="compact"
			border="start"
			:type="finding.severity === 'error' ? 'error' : 'warning'"
			:closable="false"
		>
			<strong>{{ finding.reason }}</strong>

			<p v-if="nodeSummary(finding)" class="mb-1">
				{{ nodeSummary(finding) }}
			</p>

			<p class="mb-1">
				Suggested changes to the report settings of these devices are
				available for review.
			</p>

			<div v-if="verificationLines(finding).length > 0">
				<p
					v-for="(line, i) in verificationLines(finding)"
					:key="i"
					class="mb-1"
				>
					<v-chip
						size="x-small"
						:color="verificationColor(line.state)"
						class="mr-1"
					>
						{{ line.state }}
					</v-chip>
					{{ line.text }}
				</p>
			</div>

			<template #append>
				<div class="d-flex flex-column ga-1">
					<v-btn
						color="primary"
						variant="text"
						@click.stop="openDialog(finding)"
					>
						Review and apply
					</v-btn>
					<v-btn variant="text" @click.stop="dismiss(finding)">
						Dismiss for 7 days
					</v-btn>
				</div>
			</template>
		</v-alert>

		<DialogMaintenanceFinding
			v-model="dialog"
			:finding="selectedFinding"
			:socket="socket"
		/>
	</div>
</template>

<script>
import { defineAsyncComponent } from 'vue'
import { mapState } from 'pinia'
import useBaseStore from '../../stores/base'
import InstancesMixin from '../../mixins/InstancesMixin.js'
import { dismissFinding, isDismissed } from '../../lib/maintenance'

export default {
	components: {
		DialogMaintenanceFinding: defineAsyncComponent(
			() => import('../dialogs/DialogMaintenanceFinding.vue'),
		),
	},
	mixins: [InstancesMixin],
	props: {
		socket: {
			type: Object,
			required: false,
			default: null,
		},
	},
	data() {
		return {
			dialog: false,
			selectedFinding: null,
			dismissedAt: null,
		}
	},
	computed: {
		...mapState(useBaseStore, ['maintenanceFindings', 'nodes']),
		/**
		 * Findings not locally dismissed. A dismissal is keyed by the
		 * finding id and expires after 7 days.
		 */
		visibleFindings() {
			// touch `dismissedAt` so a dismissal re-renders the list
			void this.dismissedAt
			return this.maintenanceFindings.filter(
				(finding) => !isDismissed(window.localStorage, finding.id),
			)
		},
	},
	methods: {
		nodeName(nodeId) {
			const node = this.nodes.find((n) => n.id === nodeId)
			return node?._name || node?.name || `Node ${nodeId}`
		},
		nodeSummary(finding) {
			if (!finding.nodes?.length) return ''
			return finding.nodes
				.map(
					(node) =>
						`${this.nodeName(node.nodeId)} (${Math.round(
							node.hourlyRate,
						).toLocaleString()} reports/h)`,
				)
				.join(', ')
		},
		verificationLines(finding) {
			return (finding.verification ?? []).map((v) => ({
				state: v.state,
				text: `${this.nodeName(v.nodeId)}: ${v.message}`,
			}))
		},
		verificationColor(state) {
			if (state === 'verified' || state === 'verified (provisional)')
				return 'success'
			if (
				state === 'not stored' ||
				state === 'stored, no effect' ||
				state === 'regressed'
			)
				return 'error'
			return 'primary'
		},
		openDialog(finding) {
			this.selectedFinding = finding
			this.dialog = true
		},
		dismiss(finding) {
			dismissFinding(window.localStorage, finding.id)
			this.dismissedAt = Date.now()
		},
	},
}
</script>

<style></style>
