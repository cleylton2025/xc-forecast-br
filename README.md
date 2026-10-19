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

- **Robô de dados (GFS, ES + MG):** o workflow `.github/workflows/deploy.yml` roda a cada 6 horas (e a cada push). Ele baixa a rodada mais recente do GFS 0,25° direto da NOAA (AWS Open Data: gratuito, sem limite, domínio público), recorta a região, converte e publica junto com o site, com um arquivo JSON por hora (06h–20h, 7 dias). Leva poucos minutos e não grava nada no histórico do git.
  - Para rodar localmente: `pip install eccodes numpy requests` e depois `python scripts/fetch_gfs.py --out data/gfs --max-hours 5`
  - Região e horários: `REGION`, `LOCAL_HOURS` e `MAX_FORECAST` no início de `scripts/fetch_gfs.py`.
- **Open-Meteo** (CC BY 4.0): usada para o ICON, para o GFS fora da região do robô e para o detalhe de cada ponto. O plano gratuito é **só para uso não comercial** e tem limites por minuto, hora e dia por IP; a grade nesse modo tem até 90 pontos.
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
scripts/fetch_gfs.py          robô: baixa e recorta o GFS da NOAA
.github/workflows/deploy.yml  agenda o robô e publica no GitHub Pages
```

## Próximos passos

1. Calibrar os índices com voos reais.
2. Levar o detalhe do ponto também para os dados do robô e incluir o ICON (DWD), o que exige reprojetar a grade icosaédrica. Com isso o site deixa de depender da Open-Meteo, condição para uso comercial.
3. Corte vertical ao longo de uma rota, perfis de região e login.
