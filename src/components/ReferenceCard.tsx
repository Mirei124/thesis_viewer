import type { PdfReferenceCandidate } from '../lib/pdfCitationIndex';
import { referencePresentation } from '../lib/referencePresentation';

type Props = {
  reference: PdfReferenceCandidate;
  label: string;
  rawLabel: string;
  goLabel: string;
  urlLabel: string;
  onNavigate: () => void;
};

export function ReferenceCard({ reference, label, rawLabel, goLabel, urlLabel, onNavigate }: Props) {
  const presentation = referencePresentation(reference.rawText);
  return <li className="citation-reference-card">
    <p className="citation-reference-label">{label}</p>
    {presentation ? <>
      <h3 className="citation-reference-title">{presentation.title}</h3>
      <p className="citation-reference-authors">{presentation.authors}</p>
      <p className="citation-reference-meta">{[presentation.year, presentation.venue].filter(Boolean).join(' · ')}</p>
      <details className="citation-reference-original">
        <summary>{rawLabel}</summary>
        <p className="citation-reference-text">{reference.rawText}</p>
      </details>
    </> : <p className="citation-reference-text">{reference.rawText}</p>}
    <div className="citation-actions">
      <button type="button" onClick={onNavigate}>{goLabel}</button>
      {reference.sourceUrl && <a href={reference.sourceUrl} target="_blank" rel="noopener noreferrer">{urlLabel}</a>}
    </div>
  </li>;
}
