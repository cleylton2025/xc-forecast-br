# XC Brasil: previsão para voo livre

Mapa de previsão de térmicas e condições de voo (parapente e asa-delta) para o Brasil, inspirado na experiência do XC Skies, mas com **dados e cálculos próprios**.

Para usar, abra o `index.html` publicado (GitHub Pages) ou rode localmente:

```bash
python3 -m http.server 8000
# e acesse http://localhost:8000
```

Não há etapa de build: é HTML, CSS e JavaScript puro (módulos ES). O Leaflet 1.9.4 está em `vendor/`.

## O que tem

- **Mapa com camadas** em três grupos: Térmica / Sustentação, Nuvens / Tempo e Vento / Superfície (23 camadas).
- **Modelos GFS (~25 km) e ICON (~13 km)**, com uma grade de 7 dias × 24 h no horário de Brasília.
- **Barbelas de vento** na superfície, no teto útil ou em altitudes fixas (600 a 9.000 m).
- **Clique em qualquer ponto** para ver:
  - **Dia**: gráfico hora a hora do teto útil, do topo da camada e dos cúmulos, mais uma tabela de subida, vento, nuvens, chuva e potencial XC;
  - **Sondagem**: diagrama Skew-T com temperatura, ponto de orvalho, parcela, teto útil e base das nuvens;
  - **Comparar modelos**: GFS × ICON lado a lado.
- **Busca** de cidades e locais, **favoritos** (salvos no navegador), **animação** das horas e controle de **opacidade**.
- **Link compartilhável**: a URL guarda a vista, o modelo, a camada, o vento e a hora.

## Como os índices são calculados (`js/physics.js`)

| Índice | Método |
|---|---|
| Topo da camada limite | Método da parcela: o ar a 2 m sobe esfriando 9,8 °C/km até ficar mais frio que o ambiente |
| W* (força térmica) | Escala convectiva de Deardorff: `(g/T · H/(ρ·cp) · D)^(1/3)`, com H = fluxo de calor sensível do modelo |
| Teto útil / conservador | Maior altura em que `W* · f(z/D)` ≥ 1,14 m/s (útil) ou 1,5 m/s (conservador), com `f ∝ x^(1/3)(1−1,1x)` (perfil Allen/RASP), limitado à base da nuvem |
| Base dos cúmulos | Nível de condensação `125 × (T − Td)`, mostrado só onde a térmica alcança esse nível |
| Espessura dos cúmulos | Ascensão saturada com entranhamento a partir da base |
| LI | Parcela levada até 500 hPa (seca até a base, saturada acima) |
| Potencial XC | Pontuação por altura útil e subida, com penalidades por vento forte, céu encoberto, chuva e nuvens profundas |

Os pontos de calibração estão no topo de `physics.js` (`LIFT_USABLE`, `GLIDER_SINK`, `ENTRAINMENT`, perfil `liftShape`) e em `xcClass()`. **O próximo passo natural é calibrar com voos reais** (por exemplo, tracklogs do XContest na região).

## Dados e limites

- Os dados vêm da [Open-Meteo](https://open-meteo.com/) (CC BY 4.0). O **plano gratuito é só para uso não comercial** e tem limite diário por IP. Cada carga de área usa ~600 "chamadas", o que dá cerca de 15 cargas de área por dia por conexão. Há cache em memória durante a sessão.
- Para caber no limite, a grade tem no máximo 150 pontos. Em áreas grandes ela fica mais grossa; aproximar o mapa refina.
- Modelos globais não resolvem relevo fino, brisa marítima nem convecção local.

## Estrutura

```
index.html        página
css/app.css       estilos (claro/escuro, responsivo)
js/app.js         estado, mapa, interface
js/api.js         Open-Meteo: grade, ponto, busca
js/physics.js     cálculos de meteorologia de voo
js/render.js      cores, desenho da camada, legenda, barbelas
js/point.js       painel do ponto (gráfico, Skew-T, comparação)
js/config.js      catálogo de camadas, escalas, mapas base
```

## Próximos passos

1. Calibrar os índices com voos reais.
2. Ter um servidor próprio que processe os arquivos GRIB do GFS/ICON (gratuitos, sem limite), com resolução nativa no país inteiro e sem depender da cota da Open-Meteo. Isso é obrigatório para uso comercial.
3. Corte vertical ao longo de uma rota, perfis de região e login.
