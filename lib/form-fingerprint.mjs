import {hash} from './core.mjs';

// DOM positions locate controls in the current observation; they do not change
// the meaning of a reviewed field or its choices when unrelated nodes appear.
export function normalizedFormField({target,index,...field}){
 return {...field,...(Array.isArray(field.options)?{options:field.options.map(({index,...option})=>option)}:{})};
}

export function normalizedFormFingerprint(snapshot){
 return hash({url:snapshot.url,fields:(snapshot.form?.fields||[]).map(normalizedFormField),expired:snapshot.expired});
}

export function normalizedControlFingerprint(controls){
 // Scrolling the reviewed submit control into view must not expire approval.
 // Filled values, validity, choices and form association remain significant.
 return hash(controls.map(({inViewport,...control})=>normalizedFormField(control)));
}
