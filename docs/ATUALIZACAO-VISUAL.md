# PetFlow — atualização visual de 29/10/2026

A loja e o painel receberam o estilo solicitado na referência `layout-pet.png`, mantendo verde-petróleo, coral, amarelo, marca PetFlow e componentes existentes. Esta etapa foi validada na prévia local; não registra publicação em produção.

## Aparência e conteúdo

- Cabeçalho em duas linhas, busca ampla, navegação por animais e adaptação ao celular.
- Vitrine compacta, fotos inteiras dos produtos, categorias com fotos dos animais e atalhos móveis.
- Carrossel com os quatro banners anteriores e um novo banner de abertura; cinco indicadores. Newsletter, consentimento, serviços, benefícios e rodapé preservados.
- Painel com menu azul-marinho, superfícies claras, indicadores coloridos, formulários e tabelas responsivos. Todos os módulos anteriores permanecem acessíveis.
- Répteis em `/categorias/repteis`, com jabuti no card. O filtro reconhece produtos para jabutis, tartarugas, répteis e quelônios. A migração `125_categoria_repteis.sql` disponibiliza a categoria para o cadastro administrativo, preservando registros existentes.
- Na revisão da busca foi corrigido um aviso contraditório de ausência de resultados que aparecia junto a produtos encontrados.

## Entrega demonstrativa

`/entrega-demo.html` apresenta cards, etapas da entrega e acesso ao Google Maps inspirados no fluxo atual do projeto Nação Animal, com identidade PetFlow. O trajeto de exemplo usa os pontos públicos Marble Arch e Serpentine Gallery, em Londres. O mapa desenhado é ilustrativo, sem precisão geográfica ou trânsito.

A simulação dura 90 segundos, permite iniciar, pausar, retomar e reiniciar e pausa ao sair da página. Não lê GPS, credenciais, pedidos ou armazenamento, não chama APIs de pedidos e não altera a origem de frete operacional. O link externo contém origem e destino fixos de exemplo. O GPS existente em `/entrega.html` e seus contratos foram preservados.

Há atalhos para a demonstração no rodapé da loja e nos atalhos do dashboard.

## Verificações executadas

- 223 testes automatizados aprovados, incluindo busca, filtro Répteis, simulação e regressões existentes de GPS/pagamentos/sessão.
- Sintaxe de 216 arquivos JavaScript aprovada.
- 530 links locais válidos; análise sintática dos CSS modificados aprovada.
- Integração PostgreSQL 18 em banco novo isolado aprovada com as 53 migrações. A categoria foi testada quanto à criação, reaplicação, preservação de dados/estado e conflitos entre empresas.
- Todos os 19 IDs originais da home preservados; quantidade de indicadores confere com os cinco slides.
- Navegador: vitrine desktop/celular, produto, painel e formulário administrativo; busca, favoritos, sacola e newsletter na prévia com respostas locais de demonstração. Nenhum e-mail ou pagamento real foi enviado por esse ensaio.
- Demonstração de entrega testada em desktop e largura de 320 px, sem overflow horizontal; iniciar/pausar/reiniciar conferidos.

## Imagens

Método: ferramenta integrada `image_gen`, sem CLI/API. Os arquivos PNG gerados e todas as imagens anteriores foram preservados. As telas usam cópias JPEG otimizadas, com qualidade 85, largura de 800 px nas categorias e 1920 px no banner. Os sete JPEG somam aproximadamente 0,78 MB.

Arquivos utilizados:

- `public/images/hero/petflow-bem-estar-20261029.jpg`
- `public/images/categories/dogs-photo-20261029.jpg`
- `public/images/categories/cats-photo-20261029.jpg`
- `public/images/categories/birds-photo-20261029.jpg`
- `public/images/categories/fish-photo-20261029.jpg`
- `public/images/categories/rodents-photo-20261029.jpg`
- `public/images/categories/jabuti-photo-20261029.jpg`

### Prompt final do banner

Use case: photorealistic-natural. Asset: website ecommerce hero photograph for PetFlow pet shop. Create one beautiful ultra-wide horizontal banner photograph, intended aspect ratio about 3:1. A happy healthy golden retriever and a small tabby cat sit together on the RIGHT HALF, softly sunlit in a cozy garden/pet-friendly home setting. Their faces fully inside frame, realistic fur and warm expressive eyes, sophisticated editorial pet photography. LEFT HALF is mostly uncluttered deep petroleum teal (#04766d blending #045a54) softly blurred background/negative space suitable for overlaying HTML white text; no objects or animals on left third. Accents subtle warm cream, sunlight gold #f8c846 and tiny coral #ff6b4a detail such as a collar. Background gently transitions naturally from shaded teal left to warm natural light right. Balanced premium pet ecommerce art direction. NO text, NO letters, NO logos, NO prices, NO icons, NO borders, NO UI. Wide landscape composition; no crop of animal faces.

### Prompts finais das categorias

# Fotos de categorias PetFlow — 29/10/2026

Método: ferramenta integrada image_gen (sem CLI/API). Imagens novas; arquivos anteriores preservados. Uma geração por animal. Inspeção visual concluída: golden, gato tabby, calopsita, betta, hamster e jabuti terrestre.

## jabuti-photo-20261029.png

Destino: `public/images/categories/jabuti-photo-20261029.png`

Prompt final:

Use case: photorealistic-natural. A high-quality pet ecommerce category photograph. One animal only, centered, with comfortable margin around its head and body, square composition suitable for a landscape 4:3 card crop. Natural soft daylight, realistic anatomy and fine textures, premium editorial animal photography. A softly blurred pastel cream and pale mint background, delicate warm light, subtle harmony with petroleum teal #04766d, coral and golden accents. No text, no logos, no UI, no products, no packaging, no collage. Subject: a real adult Brazilian red-footed tortoise (jabuti) on natural dry earth with a few soft green leaves, viewed at its low eye level, facing slightly toward camera. Distinctive high domed dark shell with warm golden centers, sturdy thick scaly terrestrial legs, small red-orange scale accents. Entire tortoise visible, especially its face, shell and feet. It must be unmistakably a land tortoise, NOT an aquatic turtle, no water, no pond, no flippers.

## dogs-photo-20261029.png

Destino: `public/images/categories/dogs-photo-20261029.png`

Prompt final:

Use case: photorealistic-natural. A high-quality pet ecommerce category photograph. One animal only, centered, with comfortable margin around its head and body, square composition suitable for a landscape 4:3 card crop. Natural soft daylight, realistic anatomy and fine textures, premium editorial animal photography. A softly blurred pastel cream and pale mint background, delicate warm light, subtle harmony with petroleum teal #04766d, coral and golden accents. No text, no logos, no UI, no products, no packaging, no collage. Subject: one happy golden retriever dog, head and upper chest portrait, facing camera, friendly natural expression, realistic golden fur, full ears visible. Cream/mint softly blurred backdrop.

## cats-photo-20261029.png

Destino: `public/images/categories/cats-photo-20261029.png`

Prompt final:

Use case: photorealistic-natural. A high-quality pet ecommerce category photograph. One animal only, centered, with comfortable margin around its head and body, square composition suitable for a landscape 4:3 card crop. Natural soft daylight, realistic anatomy and fine textures, premium editorial animal photography. A softly blurred pastel cream and pale mint background, delicate warm light, subtle harmony with petroleum teal #04766d, coral and golden accents. No text, no logos, no UI, no products, no packaging, no collage. Subject: one beautiful brown tabby domestic cat, seated portrait, facing camera, alert gentle expression, bright natural eyes, entire ears and head visible, realistic fur. Warm cream softly blurred backdrop.

## birds-photo-20261029.png

Destino: `public/images/categories/birds-photo-20261029.png`

Prompt final:

Use case: photorealistic-natural. A high-quality pet ecommerce category photograph. One animal only, centered, with comfortable margin around its head and body, square composition suitable for a landscape 4:3 card crop. Natural soft daylight, realistic anatomy and fine textures, premium editorial animal photography. A softly blurred pastel cream and pale mint background, delicate warm light, subtle harmony with petroleum teal #04766d, coral and golden accents. No text, no logos, no UI, no products, no packaging, no collage. Subject: one friendly cockatiel (calopsita) bird perched naturally on a simple thin branch, entire bird visible including raised crest, beak, orange cheeks, both wings and tail, facing slightly toward camera. Natural grey, white and warm yellow feathers, realistic bird anatomy. Soft airy cream and pale mint blurred garden background.

## fish-photo-20261029.png

Destino: `public/images/categories/fish-photo-20261029.png`

Prompt final:

Use case: photorealistic-natural. A high-quality pet ecommerce category photograph. One animal only, centered, with comfortable margin around its head and body, square composition suitable for a landscape 4:3 card crop. Natural soft daylight, realistic anatomy and fine textures, premium editorial animal photography. A softly blurred pastel cream and pale mint background, delicate warm light, subtle harmony with petroleum teal #04766d, coral and golden accents. No text, no logos, no UI, no products, no packaging, no collage. Subject: one beautiful blue and red betta fish swimming in clean clear water, entire fish and flowing fins fully visible, side profile facing slightly toward camera. Realistic aquatic photography, deep petroleum teal and pale mint water background with subtle soft light, sparse blurred aquatic plants far behind, no bowl edges, no aquarium equipment.

## rodents-photo-20261029.png

Destino: `public/images/categories/rodents-photo-20261029.png`

Prompt final:

Use case: photorealistic-natural. A high-quality pet ecommerce category photograph. One animal only, centered, with comfortable margin around its head and body, square composition suitable for a landscape 4:3 card crop. Natural soft daylight, realistic anatomy and fine textures, premium editorial animal photography. A softly blurred pastel cream and pale mint background, delicate warm light, subtle harmony with petroleum teal #04766d, coral and golden accents. No text, no logos, no UI, no products, no packaging, no collage. Subject: one adorable golden Syrian hamster sitting naturally on a simple light cream surface, entire hamster visible including round ears and tiny paws, facing slightly toward camera. Fine realistic fur, natural eyes, no clothes, no wheel or cage, softly blurred cream/mint background.

