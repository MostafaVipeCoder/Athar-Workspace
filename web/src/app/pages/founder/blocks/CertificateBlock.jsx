import FounderCertificateButton from '../FounderCertificateButton.jsx'

/**
 * The certificate(s) of this project: only present when the DB says issued to me + not revoked + project completed + node shown (no teaser).
 * The participant's status does not matter (08 section 18.2): a WITHDRAWN founder's page sends this block too, and nothing else.
 */
export default function CertificateBlock({ block, projectId }) {
  // the section already carries the title "My certificate"
  return <FounderCertificateButton projectId={projectId} items={block.data?.items ?? []} showHeading={false} />
}
