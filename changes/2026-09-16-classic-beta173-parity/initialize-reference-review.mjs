export function initializeReferenceReview(cases, { betaWikiCommit, reconstructedCommit }) {
  for (const entry of cases) {
    const hasReconstructedSource = entry.evidence.some((source) => source.uri.includes(reconstructedCommit));
    const hasIndependentWiki = entry.evidence.some(
      (source) => source.uri.includes(betaWikiCommit) || source.uri.includes('retromc.org'),
    );
    const hasOfficialVersionIdentity = entry.evidence.some((source) =>
      source.uri.startsWith('https://piston-meta.mojang.com/'),
    );
    entry.review = {
      evidenceLevel:
        entry.referenceStatus === 'PROJECT_CONTRACT_CANDIDATE_REVIEW'
          ? 'PROJECT_CONTRACT_CANDIDATE'
          : hasOfficialVersionIdentity && !hasReconstructedSource
            ? 'OFFICIAL_VERSION_IDENTITY_ONLY'
            : hasReconstructedSource && hasIndependentWiki
              ? 'RECONSTRUCTED_PLUS_COMMUNITY_CANDIDATE'
              : hasReconstructedSource
                ? 'RECONSTRUCTED_SOURCE_CANDIDATE'
                : hasIndependentWiki
                  ? 'COMMUNITY_SOURCE_CANDIDATE'
                  : 'NONE',
      confidence: 'UNREVIEWED',
      exception: null,
      ownerReview: 'PENDING',
    };
    entry.fixture = {
      status: 'NOT_FIXED',
      initialStateDigest: null,
      rngState: null,
      tickInputs: null,
      negativeControl: null,
    };
    entry.executionStatus = 'NOT_RUN';
  }
}
