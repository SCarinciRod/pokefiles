Esta é uma documentação detalhada sobre o funcionamento e os cálculos de IVs (Individual Values) e EVs (Effort Values) na série principal de Pokémon, atualizada com base nas mecânicas vigentes até a 9ª Geração (Scarlet/Violet) e inícios de 2026.1.

 IVs (Individual Values - Valores Individuais)Os IVs representam a "genética" ou o potencial inato de um Pokémon. Eles funcionam como genes, definidos no momento em que o Pokémon é capturado ou o ovo é gerado.
 
 Alcance: 0 a 31 por atributo (HP, Ataque, Defesa, Atk. Esp, Def. Esp, Velocidade).Valor Perfeito: 31 IVs ("Best" ou "Flawless").Impacto: No Nível 100, 1 IV equivale a +1 ponto no status. Um IV 31 adiciona 31 pontos a mais no atributo comparado a um IV 0.
 
 Como conseguir: Reprodução (Breeding) com itens como Destiny Knot (passa 5 IVs dos pais) ou Bottle Caps (treinamento extremo/Hyper Training).2. EVs (Effort Values - Valores de Esforço)Os EVs representam o treinamento do Pokémon. Eles são ganhos através de batalhas, itens (vitaminas) ou minijogos.Limite Total: 510 EVs por Pokémon.Limite por Atributo: 252 EVs (anteriormente 255).Cálculo de Status: A cada 4 EVs em um atributo, o Pokémon ganha +1 ponto no status no Nível 100.
 
 Eficiência: 252 EVs geram \(252 \div 4 = 63\) pontos adicionais no nível 100.
 
 Distribuição Comum (VGC): 252/252/4 (maximiza dois atributos e 4 pontos no terceiro).3. Fórmulas de Cálculo de Status (Gen 3-9)Os status finais são calculados com base na Base Stat (estatística base da espécie), IV, EV, Nível e Natureza.
 
 A.Fórmula para HP (Pontos de Vida)\(\text{HP}=\left\lfloor \frac{(2\times \text{Base}+\text{IV}+\lfloor \frac{\text{EV}}{4}\rfloor )\times \text{Nível}}{100}\right\rfloor +\text{Nível}+10\)B. Fórmula para outros Status (Atk, Def, SpA, SpD, Spe)\(\text{Status}=\left(\left\lfloor \frac{(2\times \text{Base}+\text{IV}+\lfloor \frac{\text{EV}}{4}\rfloor )\times \text{Nível}}{100}\right\rfloor +5\right)\times \text{Natureza}\)
 
 Natureza: Aumenta um status em 10% (\(\times 1.1\)) e diminui outro em 10% (\(\times 0.9\)), ou neutra (\(\times 1.0\)).\(\lfloor \dots \rfloor\) 
 
 (Piso): Indica que o resultado deve ser arredondado para baixo.4. 
 
 Como funcionam no Nível 50 (VGC/Competitivo)A maioria das batalhas competitivas ocorre no Nível 50. As regras mudam ligeiramente:IVs: 31 IVs adicionam 15-16 pontos a mais (metade do nível 100).EVs: 8 EVs equivalem a +1 ponto no status, mas os primeiros 4 EVs ainda contam como +1.5. Resumo das DiferençasCaracterísticaIVs (Genética)EVs (Treinamento)Alcance0 - 310 - 252 (por stat)Total6 stats com 31 cada510 no totalMudançaImutável (exceto Hyper Training)Pode ser resetado (Bagas)Como ganhaNascimento/CapturaLuta/VitaminasDica: Utilize calculadoras online como o Marriland IV Calculator ou ferramentas in-game para verificar os valores, especialmente com o "Judge Function" desbloqueado.