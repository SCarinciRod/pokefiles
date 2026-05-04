O cálculo dos atributos (stats) de um Pokémon nos jogos principais (como Scarlet & Violet ou Sword & Shield) é feito através de fórmulas matemáticas que consideram o Base Stat (BS), Nível (L), IVs (Individual Values), EVs (Effort Values) e a Natureza (Nature).

A fórmula principal para o HP é diferente das fórmulas para Ataque, Defesa, Ataques Especiais, Defesa Especial e Velocidade.1. Fórmula de HP (Pontos de Vida)O HP é calculado separadamente porque não é influenciado pela Natureza e escala de forma diferente.

\(\text{HP}=\left\lfloor \frac{(2\times \text{BS}+\text{IV}+\lfloor \frac{\text{EV}}{4}\rfloor )\times \text{L}}{100}\right\rfloor +\text{L}+10\)Nota: A exceção é o Shedinja, cujo HP é sempre 1.2. 

Fórmula dos Outros Stats (Atk, Def, SpA, SpD, Spe)Para todos os outros atributos, a fórmula inclui o multiplicador da Natureza.\(\text{Stat}=\left\lfloor \left(\left\lfloor \frac{(2\times \text{BS}+\text{IV}+\lfloor \frac{\text{EV}}{4}\rfloor )\times \text{L}}{100}\right\rfloor +5\right)\times \text{Natureza}\right\rfloor \)

Componentes da FórmulaBase Stat (BS): Valor fixo de cada espécie de Pokémon (ex: Mewtwo tem 154 de base SP Atk).IVs (Individual Values): Varia de 0 a 31 para cada status. 

Determina o "potencial" genético do Pokémon.EVs (Effort Values): Pontos de treinamento (de 0 a 252 por stat).

 A cada 4 EVs, ganha-se 1 ponto no status no nível 100.Nível (L): Nível atual do Pokémon (1 a 100).Natureza (Nature): Pode aumentar um stat em 10% (\(\times 1.1\)) e diminuir outro em 10% (\(\times 0.9\)), ou ser neutra.\(\lfloor \dots \rfloor\) (Piso): Significa "arredondar para baixo" (floor) qualquer resultado decimal.Exemplo Prático (Nível 100)Imagine um Pokémon com 100 de Base Stat em Velocidade, 31 IVs (perfeito), 252 EVs (treinado) e Natureza neutra no Nível 100:Fórmula: \(\lfloor\frac{(2 \times 100 + 31 + \lfloor\frac{252}{4}\rfloor) \times 100}{100} + 5\rfloor\)Cálculo: \(\lfloor\frac{(200 + 31 + 63) \times 100}{100} + 5\rfloor\)Resultado: \(\lfloor 294 + 5 \rfloor = 299\) de Velocidade.
 
 Mudanças no Nível 50Em batalhas competitivas (nível 50), a fórmula é similar, mas os benefícios de EVs e IVs são reduzidos pela metade em relação ao nível 100, pois o escalonamento é menor..Nota: Este cálculo difere totalmente do Pokémon GO, que utiliza uma fórmula baseada em "Combat Power" (PC), CP Multiplier e uma penalidade de 9% para Pokémon muito fortes.