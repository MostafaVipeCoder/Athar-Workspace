import FounderCertificateButton from '../FounderCertificateButton.jsx'

/** The certificate(s) of this project: only present when the DB says issued + not revoked + attended + completed (no teaser). */
export default function CertificateBlock({ block, projectId }) {
  // the section already carries the title "My certificate"
  return <FounderCertificateButton projectId={projectId} items={block.data?.items ?? []} showHeading={false} />
}
