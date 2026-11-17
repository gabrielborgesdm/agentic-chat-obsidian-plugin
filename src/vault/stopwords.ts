/** Common English + Portuguese words ignored when turning a chat message into a search query. */
export const STOPWORDS = new Set(
  (
    "a o as os um uma uns umas de do da dos das em no na nos nas por para com sem sobre entre e ou mas que qual quais quem " +
    "como onde quando eu me meu minha meus minhas voce vc tu ele ela nos eles elas seu sua seus suas isso isto esse essa este esta " +
    "foi ser sao era tem ter tenho temos fazer faz fiz quero preciso pode podes pode favor por favor " +
    "the an of to in on at for with without about between and or but that which what who whom how where when i me my mine you your " +
    "he she it we they them his her its our their this these those is are was were be been have has had do does did can could " +
    "would should please show tell find search note notes write wrote make create give list"
  ).split(/\s+/)
);
