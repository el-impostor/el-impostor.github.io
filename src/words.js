/* =========================================================
   BANCO DE PALABRAS OFICIAL
   Formato de cada palabra: "palabra|parecida"
   La parte tras "|" es la palabra parecida (modos «Palabra parecida»
   e «Infiltrado»). Si falta, se elige otra palabra de la misma categoría.
   d = dificultad de la categoría (1 fácil, 2 normal, 3 difícil)
   h = tono de color (0-360) · ab = abreviatura de la ficha
   Para añadir una categoría nueva basta con añadir un objeto aquí.
   ========================================================= */
const WORDS = [
  { id: 'cine', name: 'Cine y series', ab: 'Ci', h: 350, d: 2,
    desc: 'Películas y series que todo el mundo ha visto (o dice haber visto).',
    subs: [
      { id: 'peliculas', name: 'Películas', words: ['Titanic|Avatar','Star Wars|Star Trek','El Padrino|Scarface','Harry Potter|El Señor de los Anillos','Jurassic Park|King Kong','Toy Story|Shrek','El Rey León|Bambi','Matrix|Origen','Gladiator|Troya','Frozen|Enredados','Tiburón|Megalodón','Rocky|Creed','Regreso al futuro|Terminator','Torrente|Ocho apellidos vascos','Barbie|Oppenheimer','Indiana Jones|La momia','Piratas del Caribe|Peter Pan','Coco|Encanto','Up|Wall-E','Los Vengadores|Liga de la Justicia','Batman|Spider-Man','Mamma Mia|Grease','Interstellar|Gravity','Pulp Fiction|Reservoir Dogs','Jumanji|Zathura','Buscando a Nemo|La sirenita','Cazafantasmas|Men in Black','E.T.|Los Goonies'] },
      { id: 'series', name: 'Series', words: ['Friends|Cómo conocí a vuestra madre','Juego de Tronos|La casa del dragón','La casa de papel|Élite','Breaking Bad|Better Call Saul','Stranger Things|Dark','Los Simpson|Padre de familia','The Office|Parks and Recreation','Aquí no hay quien viva|La que se avecina','Peaky Blinders|Narcos','El juego del calamar|Alice in Borderland','The Crown|Los Bridgerton','Merlí|Física o química','Sherlock|House','Perdidos|The Walking Dead','Black Mirror|Love, Death & Robots','Los Serrano|Médico de familia','Miércoles|La familia Addams','The Last of Us|The Walking Dead','Vis a vis|Orange is the New Black','Cuéntame cómo pasó|Amar es para siempre','Euphoria|Skins','Rick y Morty|Futurama','Anatomía de Grey|House'] }
    ] },
  { id: 'anime', name: 'Anime y manga', ab: 'Am', h: 320, d: 2,
    desc: 'Series, películas y personajes del anime y el manga.',
    words: ['Naruto|Boruto','Dragon Ball|One Punch Man','One Piece|Fairy Tail','Pokémon|Digimon','Death Note|Code Geass','Ataque a los titanes|Kaiju n.º 8','Mi vecino Totoro|Ponyo','El viaje de Chihiro|El castillo ambulante','Doraemon|Shin-chan','Sailor Moon|Sakura, cazadora de cartas','Oliver y Benji|Haikyuu','Demon Slayer|Jujutsu Kaisen','My Hero Academia|Black Clover','Fullmetal Alchemist|Soul Eater','Bleach|Yu Yu Hakusho','Evangelion|Mazinger Z','Spy x Family|Chainsaw Man','Detective Conan|Lupin III','Los caballeros del Zodiaco|Dragon Ball Z','Akira|Ghost in the Shell','Hunter x Hunter|Yu-Gi-Oh!','Goku|Vegeta','Pikachu|Eevee','Luffy|Zoro','Heidi|Marco'] },
  { id: 'videojuegos', name: 'Videojuegos', ab: 'Vj', h: 270, d: 2,
    desc: 'Juegos, consolas y cultura gamer.',
    words: ['Minecraft|Terraria','Fortnite|Apex Legends','Mario Kart|Crash Team Racing','Tetris|Candy Crush','Pac-Man|Space Invaders','The Legend of Zelda|Elden Ring','GTA|Red Dead Redemption','FIFA|PES','Call of Duty|Battlefield','Among Us|Fall Guys','Sonic|Crash Bandicoot','Los Sims|Animal Crossing','League of Legends|Dota','Clash Royale|Brawl Stars','Street Fighter|Tekken','Super Mario|Donkey Kong','Halo|Doom','Uncharted|Tomb Raider','Roblox|Garry\'s Mod','Assassin\'s Creed|Prince of Persia','Just Dance|Guitar Hero','mando|teclado','consola|máquina recreativa','Game Boy|Nintendo Switch','Pokémon Go|geocaching'] },
  { id: 'deportes', name: 'Deportes', ab: 'Dp', h: 30, d: 1,
    desc: 'Deportes, competiciones y todo lo que hay alrededor.',
    words: ['tenis|pádel','baloncesto|balonmano','natación|waterpolo','ciclismo|triatlón','golf|minigolf','boxeo|kárate','esquí|snowboard','surf|windsurf','atletismo|maratón','rugby|fútbol americano','voleibol|vóley playa','Fórmula 1|MotoGP','escalada|senderismo','ajedrez|damas','béisbol|críquet','hockey|patinaje','judo|lucha libre','gimnasia|yoga','remo|piragüismo','esgrima|tiro con arco','petanca|bolos','Juegos Olímpicos|Mundial','raqueta|bate','árbitro|entrenador','medalla|trofeo'] },
  { id: 'futbol', name: 'Fútbol', ab: 'Ft', h: 140, d: 2,
    desc: 'Equipos, jugadores y jerga futbolera.',
    subs: [
      { id: 'equipos', name: 'Equipos', words: ['Real Madrid|Atlético de Madrid','FC Barcelona|Espanyol','Sevilla|Betis','Athletic Club|Real Sociedad','Valencia|Villarreal','Manchester United|Manchester City','Liverpool|Everton','Bayern de Múnich|Borussia Dortmund','Juventus|Inter de Milán','PSG|Olympique de Marsella','Boca Juniors|River Plate','Celta|Deportivo'] },
      { id: 'jugadores', name: 'Jugadores', words: ['Messi|Maradona','Cristiano Ronaldo|Mbappé','Iniesta|Xavi','Casillas|Buffon','Lamine Yamal|Nico Williams','Sergio Ramos|Piqué','Fernando Torres|Raúl','Pelé|Ronaldinho','Zidane|Figo','Haaland|Lewandowski','Vinícius|Neymar','Modrić|Kroos','Pedri|Gavi'] },
      { id: 'conceptos', name: 'Jerga y conceptos', words: ['penalti|falta','fuera de juego|VAR','córner|saque de banda','tarjeta roja|tarjeta amarilla','portero|defensa','Champions|Europa League','derbi|clásico','gol|chilena','Balón de Oro|Bota de Oro','banquillo|vestuario','prórroga|tanda de penaltis','Mundial|Eurocopa'] }
    ] },
  { id: 'musica', name: 'Música y artistas', ab: 'Mu', h: 290, d: 1,
    desc: 'Cantantes, grupos, géneros e instrumentos.',
    words: ['Rosalía|Bad Bunny','Shakira|Karol G','Taylor Swift|Olivia Rodrigo','Michael Jackson|Prince','The Beatles|The Rolling Stones','Alejandro Sanz|David Bisbal','Estopa|Melendi','Quevedo|Bizarrap','Madonna|Lady Gaga','Coldplay|Imagine Dragons','Eminem|50 Cent','guitarra|bajo','batería|piano','reguetón|trap','flamenco|sevillanas','ópera|zarzuela','rock|heavy metal','Eurovisión|Operación Triunfo','karaoke|concierto','festival|discoteca','Aitana|Lola Índigo','Beyoncé|Rihanna','Freddie Mercury|Elvis Presley','AC/DC|Metallica','micrófono|altavoz'] },
  { id: 'famosos', name: 'Celebridades y famosos', ab: 'Fm', h: 45, d: 2,
    desc: 'Gente conocida de la tele, el cine, el deporte y las redes.',
    words: ['Leonardo DiCaprio|Brad Pitt','Penélope Cruz|Antonio Banderas','Rafa Nadal|Roger Federer','Elon Musk|Jeff Bezos','Ibai|El Rubius','Kim Kardashian|Paris Hilton','Fernando Alonso|Carlos Sainz','Pau Gasol|Michael Jordan','Isabel Preysler|Tamara Falcó','Belén Esteban|Jorge Javier Vázquez','Karlos Arguiñano|Alberto Chicote','Pablo Motos|David Broncano','Zendaya|Tom Holland','Tom Cruise|Keanu Reeves','Marilyn Monroe|Audrey Hepburn','Mr. Bean|Charlie Chaplin','Gordon Ramsay|Jamie Oliver','Dalí|Picasso','Steve Jobs|Steve Wozniak','Mark Zuckerberg|Bill Gates','Lola Flores|Rocío Jurado'] },
  { id: 'animales', name: 'Animales', ab: 'An', h: 95, d: 1,
    desc: 'Del gato del vecino a la orca más grande del océano.',
    words: ['perro|lobo','gato|tigre','león|leopardo','elefante|rinoceronte','jirafa|cebra','delfín|tiburón','ballena|orca','pingüino|foca','águila|halcón','búho|lechuza','serpiente|lagarto','tortuga|caracol','rana|sapo','mono|gorila','canguro|koala','oso|oso panda','conejo|liebre','caballo|burro','vaca|toro','cerdo|jabalí','gallina|pato','abeja|avispa','mariposa|polilla','hormiga|termita','pulpo|calamar','cocodrilo|caimán','murciélago|ratón','camello|dromedario','hámster|cobaya','flamenco|cigüeña','perezoso|oso hormiguero','medusa|estrella de mar'] },
  { id: 'comida', name: 'Comida y bebida', ab: 'Co', h: 15, d: 1,
    desc: 'Platos, tapas, postres y bebidas.',
    words: ['paella|arroz negro','tortilla de patatas|revuelto','pizza|calzone','hamburguesa|perrito caliente','sushi|ramen','gazpacho|salmorejo','churros|porras','croquetas|empanadillas','jamón|chorizo','queso|mantequilla','pan|tostada','helado|granizado','café|té','cerveza|sidra','vino|cava','zumo de naranja|limonada','palomitas|nachos','patatas fritas|patatas bravas','ensalada|macedonia','lentejas|garbanzos','cocido|fabada','tacos|burritos','espaguetis|macarrones','fresa|frambuesa','plátano|mango','sandía|melón','manzana|pera','limón|lima','ajo|cebolla','donut|cruasán','tarta|bizcocho','sangría|tinto de verano','kebab|shawarma','mayonesa|alioli'] },
  { id: 'paises', name: 'Países y ciudades', ab: 'Pa', h: 200, d: 1,
    desc: 'Destinos, capitales y rincones del mundo.',
    words: ['España|Portugal','Francia|Bélgica','Italia|Grecia','Japón|China','Estados Unidos|Canadá','Brasil|Argentina','México|Colombia','Egipto|Marruecos','Australia|Nueva Zelanda','Noruega|Suecia','India|Tailandia','Alemania|Austria','Reino Unido|Irlanda','Madrid|Barcelona','Sevilla|Granada','Valencia|Alicante','Bilbao|San Sebastián','París|Londres','Roma|Venecia','Nueva York|Los Ángeles','Tokio|Seúl','Ámsterdam|Berlín','Lisboa|Oporto','Cancún|Punta Cana','Ibiza|Mallorca','Tenerife|Gran Canaria','Dubái|Las Vegas','Río de Janeiro|Buenos Aires','El Cairo|Estambul','Islandia|Groenlandia','Suiza|Luxemburgo','Cuba|Puerto Rico','Santiago de Compostela|Salamanca'] },
  { id: 'historia', name: 'Historia', ab: 'Hi', h: 35, d: 2,
    desc: 'Épocas, civilizaciones y personajes históricos.',
    words: ['pirámides|esfinge','Imperio romano|Antigua Grecia','Cristóbal Colón|Magallanes','Napoleón|Julio César','Cleopatra|Nefertiti','vikingos|celtas','templarios|samuráis','Edad Media|Renacimiento','Revolución francesa|Revolución industrial','muro de Berlín|telón de acero','Segunda Guerra Mundial|Primera Guerra Mundial','llegada a la Luna|Sputnik','dinosaurios|mamuts','gladiadores|legionarios','Reyes Católicos|Felipe II','Al-Ándalus|Alhambra','Leonardo da Vinci|Miguel Ángel','castillo|fortaleza','Juana de Arco|Isabel I de Inglaterra','guillotina|hoguera','imprenta|papiro','Guerra Fría|carrera espacial','aztecas|mayas','incas|olmecas','Gran Muralla china|Muro de Adriano','Coliseo|Partenón','faraón|emperador','Gandhi|Martin Luther King'] },
  { id: 'ciencia', name: 'Ciencia y tecnología', ab: 'Ct', h: 185, d: 2,
    desc: 'Inventos, gadgets, laboratorios y espacio.',
    words: ['robot|androide','smartphone|tablet','ordenador|portátil','internet|wifi','inteligencia artificial|algoritmo','satélite|cohete','microscopio|telescopio','ADN|célula','vacuna|antibiótico','láser|radar','Bluetooth|NFC','impresora 3D|escáner','dron|helicóptero','energía solar|energía eólica','coche eléctrico|coche híbrido','realidad virtual|realidad aumentada','contraseña|huella dactilar','la nube|servidor','batería|cargador','volcán|terremoto','fósil|esqueleto','vitamina|proteína','código QR|código de barras','criptomoneda|NFT','GPS|brújula','Marte|Luna','hacker|virus informático','Einstein|Newton','Marie Curie|Rosalind Franklin'] },
  { id: 'fisica', name: 'Física y matemáticas', ab: 'Fx', h: 230, d: 3,
    desc: 'Para los de ciencias: conceptos que dan juego (y dolor de cabeza).',
    words: ['gravedad|magnetismo','átomo|molécula','electrón|protón','neutrón|neutrino','agujero negro|estrella de neutrones','Big Bang|expansión del universo','relatividad|mecánica cuántica','velocidad de la luz|año luz','energía|potencia','fricción|inercia','número pi|número e','triángulo|pirámide','círculo|esfera','ecuación|incógnita','derivada|integral','fracción|porcentaje','teorema de Pitágoras|teorema de Tales','número primo|número par','infinito|cero','logaritmo|exponente','vector|matriz','probabilidad|estadística','radiactividad|rayos X','fusión nuclear|fisión nuclear','gato de Schrödinger|principio de incertidumbre','entropía|caos','onda|partícula','péndulo|muelle','temperatura|calor','presión|densidad','prisma|arcoíris','imán|electroimán'] },
  { id: 'cultura', name: 'Cultura general', ab: 'Cg', h: 60, d: 2,
    desc: 'Arte, literatura, fiestas, monumentos y mitología.',
    words: ['La Gioconda|El grito','Don Quijote|Sancho Panza','Shakespeare|Cervantes','Premio Nobel|Óscar','Torre Eiffel|Big Ben','Estatua de la Libertad|Cristo Redentor','Sagrada Familia|catedral de Burgos','ONU|Unión Europea','sistema solar|Vía Láctea','Navidad|Reyes Magos','Halloween|Carnaval','San Fermín|Las Fallas','La Tomatina|Feria de Abril','Museo del Prado|Louvre','Guernica|Las meninas','Romeo y Julieta|Hamlet','diccionario|enciclopedia','euro|dólar','horóscopo|tarot','calendario|reloj de arena','bandera|himno','monarquía|república','mitología griega|mitología nórdica','Zeus|Poseidón','Hércules|Aquiles','sirena|unicornio','dragón|grifo'] },
  { id: 'objetos', name: 'Objetos cotidianos', ab: 'Ob', h: 170, d: 1,
    desc: 'Cosas que tienes en casa, en la mochila o en el bolsillo.',
    words: ['cepillo de dientes|peine','paraguas|chubasquero','llaves|candado','gafas|lentillas','mando a distancia|móvil','sartén|olla','tenedor|cuchara','cuchillo|tijeras','almohada|cojín','sofá|sillón','lámpara|vela','espejo|ventana','despertador|reloj de pulsera','mochila|maleta','cartera|monedero','bolígrafo|lápiz','cuaderno|agenda','toalla|albornoz','ducha|bañera','nevera|congelador','microondas|horno','lavadora|lavavajillas','escoba|fregona','papel higiénico|pañuelos','enchufe|alargador','auriculares|altavoz','botella|vaso','taza|termo','bombilla|linterna','zapatillas|chanclas','calcetines|guantes','bufanda|corbata','cinta adhesiva|pegamento','grapadora|clip','percha|armario','tostadora|cafetera','secador|plancha'] },
  { id: 'profesiones', name: 'Profesiones', ab: 'Pr', h: 215, d: 1,
    desc: 'Oficios y trabajos de todo tipo.',
    words: ['médico|enfermero','profesor|tutor','bombero|socorrista','policía|guardia de seguridad','cocinero|camarero','piloto|azafato','astronauta|astrónomo','abogado|juez','arquitecto|ingeniero','dentista|oculista','veterinario|granjero','peluquero|barbero','fontanero|electricista','carpintero|albañil','periodista|presentador de televisión','actor|cantante','futbolista|árbitro','mago|payaso','panadero|pastelero','cartero|mensajero','taxista|conductor de autobús','programador|diseñador gráfico','científico|inventor','detective|espía','pescador|marinero','agricultor|jardinero','youtuber|influencer','psicólogo|coach','carnicero|pescadero','fotógrafo|pintor','bibliotecario|librero','farmacéutico|químico','mecánico|chapista','DJ|músico'] },
  { id: 'marcas', name: 'Marcas', ab: 'Mc', h: 0, d: 1,
    desc: 'Logos que reconocerías con los ojos cerrados.',
    words: ['Coca-Cola|Pepsi','McDonald\'s|Burger King','Apple|Samsung','Nike|Adidas','Zara|H&M','Mercadona|Carrefour','Amazon|AliExpress','IKEA|Leroy Merlin','Netflix|HBO Max','Spotify|Apple Music','WhatsApp|Telegram','Instagram|TikTok','Ferrari|Lamborghini','Tesla|BMW','Lego|Playmobil','Nutella|Nocilla','Chupa Chups|Kinder','Disney|Pixar','Nintendo|PlayStation','Red Bull|Monster','Starbucks|Dunkin\'','Seat|Renault','Ryanair|Vueling','Mahou|Estrella Galicia','ColaCao|Nesquik','Telepizza|Domino\'s','El Corte Inglés|FNAC','Decathlon|Sprinter','Mercedes|Audi','Uber|Cabify','Pringles|Lay\'s','YouTube|Twitch'] },
  { id: 'internet', name: 'Internet, memes y cultura viral', ab: 'In', h: 255, d: 2,
    desc: 'Redes sociales, memes, jerga online y fenómenos virales.',
    words: ['meme|gif','selfi|story','hashtag|trending topic','streaming|directo','emoji|sticker','troll|hater','clickbait|spoiler','unboxing|reseña','reto viral|baile de TikTok','Rickroll|Doge','Gangnam Style|Despacito','Nyan Cat|Grumpy Cat','La Velada del Año|Twitch Rivals','modo avión|modo silencio','captcha|cookies','cringe|vergüenza ajena','stalkear|cotillear','ghosting|bloquear','visto|doble check','pódcast|radio','filtro|Photoshop','bulo|fake news','dejar de seguir|silenciar','ASMR|mukbang','fandom|club de fans','chatbot|asistente de voz','Wikipedia|enciclopedia','Reddit|Forocoches','LinkedIn|InfoJobs','ok boomer|cuñadismo'] },
  { id: 'abstractos', name: 'Palabras difíciles y abstractas', ab: 'Ab', h: 300, d: 3,
    desc: 'Conceptos sin forma: aquí el impostor sufre de verdad.',
    words: ['libertad|independencia','felicidad|alegría','nostalgia|melancolía','envidia|celos','tiempo|eternidad','justicia|venganza','destino|casualidad','verdad|sinceridad','miedo|ansiedad','amistad|compañerismo','orgullo|vanidad','paciencia|calma','ironía|sarcasmo','karma|suerte','silencio|soledad','belleza|elegancia','éxito|fama','caos|desorden','rutina|costumbre','esperanza|fe','ambición|codicia','empatía|compasión','inspiración|creatividad','déjà vu|premonición','procrastinación|pereza','tradición|herencia','privacidad|secreto','equilibrio|armonía','intuición|instinto','memoria|recuerdo','sueño|pesadilla'] },
  { id: 'adultos', name: 'Temática para adultos', ab: '18', h: 330, d: 2, adult: true,
    desc: 'Vida adulta, fiestas y citas. Sin pasarse, pero mejor sin niños delante.',
    words: ['resaca|borrachera','despedida de soltero|boda','cita a ciegas|primera cita','ex|crush','hipoteca|alquiler','divorcio|separación','chupito|cubata','afterwork|happy hour','Tinder|Bumble','suegra|cuñado','declaración de la renta|multa','jefe|recursos humanos','beso|pico','ligar|tontear','botellón|after','luna de miel|aniversario','póker|casino','mojito|caipiriña','crisis de los 40|cumpleaños','juego de la botella|verdad o reto','lunes|domingo por la tarde','tupper|comida de empresa'] },
  { id: 'infantil', name: 'Temática infantil', ab: 'Pq', h: 110, d: 1,
    desc: 'Dibujos, cuentos y juegos para jugar con peques.',
    words: ['Peppa Pig|Bluey','Patrulla Canina|Pocoyó','Bob Esponja|Patricio','Mickey Mouse|Minnie','columpio|tobogán','piruleta|gominola','pelota|globo','muñeca|peluche','dinosaurio|dragón','castillo de arena|cubo y pala','bicicleta|patinete','Papá Noel|Ratoncito Pérez','Caperucita Roja|Blancanieves','Cenicienta|La bella durmiente','los tres cerditos|el lobo feroz','pirata|princesa','superhéroe|mago','plastilina|ceras de colores','escondite|pilla pilla','cumpleaños|piñata','pompas de jabón|cometa','tren|avión','hada|duende','zoo|granja','colegio|guardería','pijama|bata','cuento|tebeo','Tortugas Ninja|Power Rangers'] }
];

/* Preguntas sugeridas para el modo «Ronda de preguntas» y la pista
   obligatoria de tipo «responder a una pregunta». */
const QUESTIONS = [
  '¿Dónde lo encontrarías?', '¿De qué color lo imaginas?', '¿Lo tendrías en casa?',
  '¿Es más grande que una caja de zapatos?', '¿Qué edad tiene la gente a la que le gusta?',
  '¿A qué huele o sabe?', '¿Lo regalarías?', '¿En qué época del año piensas en ello?',
  '¿Cuánto cuesta, más o menos?', '¿Te da buen rollo o mal rollo?', '¿Lo harías con tus abuelos?',
  'Descríbelo con un sonido', '¿Con qué famoso lo relacionas?', '¿Es más de día o de noche?',
  '¿Dentro o fuera de casa?', 'Dime algo que NO sea', '¿Qué emoción te provoca?',
  '¿Es antiguo o moderno?', '¿Lo llevarías a una primera cita?', '¿Cabe en un bolsillo?',
  '¿Lo verías en un telediario?', '¿Es caro mantenerlo?', '¿Qué harías con ello un domingo?',
  '¿Lo asocias a algún país?', '¿Se puede romper?'
];

if (typeof module !== 'undefined') module.exports = { WORDS, QUESTIONS };
