/**
 * Primitivos de painel — compartilhados por Dashboard e Operations Workspace.
 *
 * `import { PanelFrame, PanelState } from "@/components/panels";`
 */
export { PanelErrorBoundary } from "./panel-error-boundary";
export {
  PanelAccessDenied,
  PanelMissing,
  PanelChartFrame,
  PanelEmpty,
  PanelError,
  PanelFrame,
  PanelLoading,
  PanelState,
  PanelWithoutSource,
  type PanelFrameProps,
  type PanelQuery,
} from "./panel-frame";
export { toPanelQuery } from "./to-panel-query";
