// Application prose may interpret evidence; workflow status is never an answer.
export const groundedReasoningPolicy = 'Reasonable, evidence-backed extrapolation is allowed: combine confirmed facts, explain transferable skills, and describe how documented work is relevant to the role. The answer need not repeat the CV verbatim. For example, Python MRI pipelines support biomedical data-analysis experience, and LLM agents support experience building AI workflows. Present the strongest accurate relevant experience. Do not turn these into undocumented employers, commercial deployments, regulated-industry credentials, exact years or metrics, or new personal facts. Missing CV information does not prove lack of experience. Keep internal uncertainty, source-checking notes and workflow statuses out of applicant-facing answers; an unavailable answer stays empty.';

export function isInternalAnswer(value){
 if(typeof value!=='string')return false;
 const text=value.trim().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
 return /\b(?:human\s*[:·–—-]?\s*(?:missing|needed|required)|human review (?:needed|required)|missing (?:required |personal )?information|needs? (?:human|user) (?:input|information|confirmation)|requires? (?:human|user) (?:input|information|confirmation)|(?:human|user) (?:input|confirmation) (?:needed|required))\b/i.test(text)
  || /^(?:unknown|not (?:provided|known|established)|needs? answer|needs? review|human|tbd|to be (?:determined|confirmed))[.!]?$/i.test(text)
  || /^\[(?:insert|enter|your |missing|unknown|needs? )[^\]]*\]$/i.test(text);
}
