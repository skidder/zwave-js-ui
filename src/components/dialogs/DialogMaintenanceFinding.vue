<template>
	<v-dialog v-model="_value" max-width="800px" persistent>
		<v-card v-if="finding" :loading="loading">
			<v-card-title>
				<span class="text-h5">Review suggested changes</span>
			</v-card-title>
			<v-card-subtitle>
				{{ finding.reason }}
			</v-card-subtitle>

			<v-card-text>
				<v-container>
					<template v-for="node in finding.nodes" :key="node.nodeId">
						<v-row class="ma-2" no-gutters>
							<strong>
								{{ nodeName(node.nodeId) }}
								({{
									Math.round(node.hourlyRate).toLocaleString()
								}}
								reports/h)
							</strong>
						</v-row>

						<p v-if="node.hasTaggedParams === false" class="ml-2">
							This device's config file lacks report-parameter
							tags, so no specific values can be suggested for it.
						</p>

						<v-row
							v-for="row in node.suggestionRows"
							:key="`${node.nodeId}:${row.parameter}`"
							class="ma-1"
							no-gutters
							align="center"
						>
							<v-col
								v-if="!haAttached && !row.refusedReason"
								cols="1"
							>
								<v-checkbox
									v-model="
										checked[
											`${node.nodeId}:${row.parameter}`
										]
									"
									density="compact"
									hide-details
								></v-checkbox>
							</v-col>
							<v-col v-else cols="1"></v-col>
							<v-col>
								<span>
									#{{ row.parameter }} —
									{{ purposeLabel(row.purpose) }}:
									<template v-if="row.refusedReason">
										<strong>{{ row.refusedReason }}</strong>
									</template>
									<template v-else>
										{{ currentValueText(row) }} →
										{{ row.proposedValue }}
										{{ row.unit }}
									</template>
								</span>
							</v-col>
						</v-row>

						<v-divider class="ma-2"></v-divider>
					</template>

					<v-checkbox
						v-if="!haAttached && thresholdConfirmationNeeded"
						v-model="thresholdConfirmed"
						label="Nothing outside Z-Wave JS watches this power value"
					></v-checkbox>

					<p v-if="!haAttached" class="text-caption">
						Changes are applied per device: unchecking any change of
						a device excludes the whole device, so no unchecked
						change is ever written.
					</p>

					<p v-if="haAttached" class="text-caption">
						Home Assistant is connected to this controller. Review
						and apply the changes there, so automations that watch
						these values can be checked first.
					</p>

					<p v-if="finding.verification?.length" class="text-caption">
						<template
							v-for="v in finding.verification"
							:key="v.nodeId"
						>
							{{ nodeName(v.nodeId) }}: {{ v.state }} —
							{{ v.message }}<br />
						</template>
					</p>
				</v-container>
			</v-card-text>

			<v-card-actions>
				<v-spacer></v-spacer>
				<v-btn variant="text" @click.stop="close">Close</v-btn>
				<v-btn
					v-if="haAttached"
					color="primary"
					variant="text"
					@click.stop="haFixHint"
				>
					Fix in Home Assistant → Repairs
				</v-btn>
				<v-btn
					v-else
					color="primary"
					variant="text"
					:disabled="!applyEnabled"
					:loading="loading"
					@click.stop="apply"
				>
					Apply
				</v-btn>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script>
import { mapState } from 'pinia'
import useBaseStore from '../../stores/base'
import InstancesMixin from '../../mixins/InstancesMixin.js'
import {
	applicableRows,
	applyRetryAvailable,
	canApply,
	hasThresholdRows,
	nodesToApply,
	purposeLabel,
	verificationInProgress,
} from '../../lib/maintenance'

export default {
	mixins: [InstancesMixin],
	props: {
		modelValue: {
			type: Boolean,
			required: true,
		},
		finding: {
			type: Object,
			required: false,
			default: null,
		},
		socket: {
			type: Object,
			required: false,
			default: null,
		},
	},
	data() {
		return {
			checked: {},
			thresholdConfirmed: false,
			haAttached: false,
			loading: false,
		}
	},
	computed: {
		...mapState(useBaseStore, ['nodes']),
		_value: {
			get() {
				return this.modelValue
			},
			set(val) {
				this.$emit('update:modelValue', val)
			},
		},
		thresholdConfirmationNeeded() {
			return (this.finding?.nodes ?? []).some(
				(node) =>
					applicableRows(node).length > 0 && hasThresholdRows(node),
			)
		},
		applyEnabled() {
			if (!this.finding) return false
			if (verificationInProgress(this.finding.verification)) return false
			if (
				this.finding.verification?.length &&
				!applyRetryAvailable(this.finding.verification)
			) {
				return false
			}
			return canApply(
				this.finding,
				new Map(
					Object.entries(this.checked).filter(([, v]) => v === true),
				),
				this.thresholdConfirmed,
				this.haAttached,
			)
		},
	},
	watch: {
		modelValue(open) {
			if (open) {
				this.init()
			}
		},
	},
	methods: {
		purposeLabel,
		nodeName(nodeId) {
			const node = this.nodes.find((n) => n.id === nodeId)
			return node?._name || node?.name || `Node ${nodeId}`
		},
		currentValueText(row) {
			if (row.currentValue === undefined) {
				return 'unknown'
			}
			const value = `${row.currentValue}${
				row.stillAtFactoryDefault ? ' (still at factory default)' : ''
			}`
			return value
		},
		async init() {
			this.checked = {}
			this.thresholdConfirmed = false

			// pre-check every offered row
			for (const node of this.finding?.nodes ?? []) {
				for (const row of applicableRows(node)) {
					this.checked[`${node.nodeId}:${row.parameter}`] = true
				}
			}

			// whether a Home Assistant client is attached decides between
			// the apply flow here and the read-only hint
			try {
				const response = await this.app.apiRequest(
					'isHomeAssistantAttached',
					[],
					{ infoSnack: false, errorSnack: false },
				)
				this.haAttached = response?.result === true
			} catch {
				this.haAttached = false
			}
		},
		async apply() {
			const targets = nodesToApply(
				this.finding,
				new Map(
					Object.entries(this.checked).filter(([, v]) => v === true),
				),
			)
			if (!targets.length) return

			this.loading = true
			try {
				// one explicit action: apply every fully selected device,
				// in sequence. Nothing is applied automatically anywhere.
				for (const node of targets) {
					const response = await this.app.apiRequest(
						'applyMaintenanceSuggestion',
						[this.finding.id, node.nodeId],
					)
					if (response && !response.success) {
						this.showSnackbar(
							`Applying changes to ${this.nodeName(
								node.nodeId,
							)} failed: ${response.message}`,
							'error',
						)
					}
				}
				this.close()
			} finally {
				this.loading = false
			}
		},
		haFixHint() {
			this.showSnackbar(
				'Open Home Assistant, then go to Settings → System → Repairs.',
				'info',
			)
		},
		close() {
			this._value = false
		},
	},
}
</script>

<style></style>
