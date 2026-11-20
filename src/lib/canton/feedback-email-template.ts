/** Canton feedback invitation text, used by a future reviewed sender.
 * Never infer consent from an email address alone.
 * Do not use this template to send from QA; messaging remains disabled.
 */
export type CantonEmailLanguage="fr"|"en";
export function cantonFeedbackEmail({language,department,feedbackUrl}:{language:CantonEmailLanguage;department:"DIG"|"TCF"|"OTHER";feedbackUrl:string}){
 const brand=department==="TCF"?"Texas Community Farm":department==="DIG"?"DIG":"ILEAD Global";
 if(language==="fr"){
  return {
   subject:"Votre avis sur votre visite chez "+brand,
   text:"Bonjour,\n\nMerci pour votre visite chez "+brand+" à Canton. Votre avis nous aide à améliorer notre accueil et nos services.\n\nDonnez-nous votre impression en moins d’une minute : "+feedbackUrl+"\n\nVotre participation est facultative.\n\nL’équipe "+brand,
  };
 }
 return {
  subject:"How was your visit to "+brand+"?",
  text:"Hello,\n\nThank you for visiting "+brand+" in Canton. Your feedback helps us improve our welcome and service.\n\nShare your experience in less than a minute: "+feedbackUrl+"\n\nYour feedback is optional.\n\nThe "+brand+" team",
 };
}
