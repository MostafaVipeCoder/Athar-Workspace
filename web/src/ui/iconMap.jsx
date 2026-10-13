import { Calendar, ClipboardList, Eye, FileText, Handshake, Image, LayoutTemplate, List, ListChecks, Medal, Presentation, StickyNote, Users, Box } from 'lucide-react'

/** Explicit icon imports only (tree-shaking): manifests refer to icons by key, never by importing lucide. */
const ICONS = {
  agenda: Calendar,
  form: ClipboardList,
  list: List,
  selection: ListChecks,
  booking: Handshake,
  distribution: Users,
  library: Image,
  landing: LayoutTemplate,
  certificate: Medal,
  host: Presentation,
  note: StickyNote,
  document: FileText,
  eye: Eye,
}

export function NodeIcon({ name, ...props }) {
  const Icon = ICONS[name] ?? Box
  return <Icon aria-hidden="true" {...props} />
}
