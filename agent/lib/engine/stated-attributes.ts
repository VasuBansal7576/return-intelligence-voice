/** Explicit current-garment preferences only; coordinated noun phrases inherit
 * their stated verb, while a new clause or negation replaces it. */
export function statedAttributes(text:string):Map<string,'positive'|'negative'>{
 const result=new Map<string,'positive'|'negative'>();
 for(const sentence of text.split(/[.;!?\n]|\b(?:but|however)\b/i)){
  let sentiment:'positive'|'negative'|undefined;
  for(const clause of sentence.split(/,|\band\b/i)){
   if(!clause.trim())continue;
   const verb=clause.match(/\b(?:(do not|did not|don't|don’t|didn't|didn’t|no longer|never|stop)\s+)?(like|love|prefer|keep|retain|preserve|dislike|hate|avoid)\b/i);
   if(verb)sentiment=verb[1]||/dislike|hate|avoid/i.test(verb[2]!)?'negative':'positive';
   else if(!/^\s*(?:(?:the|this|its|same|current|also)\s+)*(?:theme|design|graphic|print|colou?r|fit|length|material)\s*$/i.test(clause))sentiment=undefined;
   if(!sentiment)continue;
   const target=verb?clause.slice(verb.index!+verb[0].length):clause;
   for(const match of target.matchAll(/\b(theme|design|graphic|print|colou?r|fit|length|material)\b/gi)){
    const attribute=/theme|design|graphic|print/i.test(match[1]!)?'theme':/colou?r/i.test(match[1]!)?'color':match[1]!.toLowerCase();
    result.set(attribute,sentiment);
   }
  }
 }
 return result;
}
