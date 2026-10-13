import NodePage from './NodePage.jsx'

// Route-level wrappers so the route table can lazy-load each mode by name.
export const NodeViewPage = () => <NodePage mode="view" />
export const NodeEditPage = () => <NodePage mode="edit" />
export const NodeSettingsPage = () => <NodePage mode="settings" />
