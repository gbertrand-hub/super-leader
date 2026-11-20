export type CantonEmailLanguage="fr"|"en";
export function cantonFeedbackEmail({
 language,department,feedbackUrl,siteName
}:{
 language:CantonEmailLanguage;
 department:"DIG"|"TCF"|"OTHER";
 feedbackUrl:string;
 siteName?:string|null;
}){
 const brand=department==="TCF"?"Texas Community Farm":department==="DIG"?"DIG":"ILEAD Global";
 const location=(siteName||"ILEAD Global").trim();
 if(language==="fr"){
  return {
   subject:"Votre avis sur votre visite chez "+brand,
   text:"Bonjour,\n\nMerci pour votre visite chez "+brand+" — "+location+". Votre avis nous aide à améliorer notre accueil et nos services.\n\nDonnez-nous votre impression en moins d’une minute : "+feedbackUrl+"\n\nVotre participation est facultative.\n\nL’équipe "+brand,
  };
 }
 return {
  subject:"How was your visit to "+brand+"?",
  text:"Hello,\n\nThank you for visiting "+brand+" — "+location+". Your feedback helps us improve our welcome and service.\n\nShare your experience in less than a minute: "+feedbackUrl+"\n\nYour feedback is optional.\n\nThe "+brand+" team",
 };
}
