// NBA All-Stars list derived from the dataset you provided.
// IMPORTANT: We exclude ABA-only selections by keeping players with NBA > 0.
// We also exclude players whose last All-Star was before 1986 (only 1986+ All-Stars).
//
// Names in the API can include accents (e.g. Dončić), so we normalize names when matching.

export function normalizePlayerName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z]/g, '')
    .toLowerCase();
}

// Players whose last NBA All-Star was in 1985 or earlier (excluded so only 1986+ All-Stars).
// Do NOT include anyone who was an All-Star in 1986 or later (e.g. Jack Sikma, Marques Johnson).
// To verify: basketball-reference.com/allstar/ (year-by-year) or player pages for last All-Star year.
const LAST_ALL_STAR_BEFORE_1986_KEYS = new Set([
  'Paul Arizin', 'Elgin Baylor', 'Walt Bellamy', 'Zelmo Beaty', 'Dave Bing', 'Otis Birdsong',
  'Carl Braun', 'Frankie Brian', 'Bob Cousy', 'Dave Cowens', 'Doug Collins', 'Bob Dandridge',
  'Bob Davies', 'Dave DeBusschere', 'Wayne Embry', 'Dick Garmaker', 'Harry Gallatin', 'Tom Gola',
  'Gail Goodrich', 'Hal Greer', 'Richie Guerin', 'Cliff Hagan', 'Tom Heinsohn', 'Bailey Howell',
  'Lou Hudson', 'Mel Hutchins', 'Gus Johnson', 'Neil Johnston', 'Sam Jones', 'Rudy LaRusso',
  'Clyde Lovellette', 'Bob Lanier', 'Pete Maravich', 'Bob McAdoo', 'Slater Martin', 'Dick McGuire',
  'Vern Mikkelsen', 'George Mikan', 'Earl Monroe', 'Willie Naulls', 'Don Ohl', 'Andy Phillip',
  'Jim Pollard', 'Arnie Risen', 'Oscar Robertson', 'Guy Rodgers', 'Bill Russell', 'Dolph Schayes',
  'Gene Shue', 'Nate Thurmond', 'Rudy Tomjanovich', 'Wes Unseld', 'Chet Walker',
  'Bobby Wanzer', 'Jerry West', 'Jo Jo White', 'Paul Westphal', 'Wilt Chamberlain', 'Larry Foust',
  'Ed Macauley', 'Bob Pettit', 'John Havlicek', 'Dennis Johnson', 'Charlie Scott',
  'David Thompson', 'Billy Cunningham', 'Connie Hawkins', 'Spencer Haywood', 'Dan Issel',
  'Larry Kenon', 'Maurice Lucas', 'George McGinnis', 'Rick Barry',
  // Additional pre-1986 (last All-Star 1985 or earlier)
  'Lenny Wilkens', 'Bill Sharman', 'Jack Twyman', 'George Yardley', 'Larry Costello',
  'Walt Frazier', 'Jerry Lucas', 'Willis Reed', 'Tiny Archibald',
  'Elvin Hayes', 'Cazzie Russell', 'Randy Smith', 'Jack Marin', 'Phil Chenier',
  'Norm Nixon', 'Calvin Natt', 'Andrew Toney', 'Jeff Ruland', 'Kelly Tripucka',
  'Rickey Green', 'Jim Paxson', 'Kiki Vandeweghe',
  'Dan Roundfield', 'Johnny Green', 'Dick Van Arsdale', 'Tom Van Arsdale', 'Norm Van Lier',
  'Paul Seymour', 'Red Kerr', 'Bob Kauffman', 'Jeff Mullins', 'Bill Bridges',
  'Archie Clark', 'Terry Dischinger', 'Austin Carr', 'Jimmy Walker',
  'Mike Bantom', 'Brian Winters', 'Scott Wedman', 'Campy Russell', 'John Drew',
  'Lionel Hollins', 'Truck Robinson', 'Calvin Murphy', 'Billy Knight',
  'George Gervin', 'Michael Ray Richardson', 'Sidney Wicks',
  'Gus Williams', 'Joe Caldwell', 'Fred Schaus'
].map(normalizePlayerName));

const ALL_STAR_DATASET = `
Rk\tPlayer\tTot\tNBA\tABA
1\tLeBron James\t22\t22\t0
2\tKareem Abdul-Jabbar\t19\t19\t0
3\tKobe Bryant\t18\t18\t0
4\tKevin Durant\t16\t16\t0
5\tJulius Erving\t16\t11\t5
6\tTim Duncan\t15\t15\t0
7\tKevin Garnett\t15\t15\t0
8\tShaquille O'Neal\t15\t15\t0
9\tMichael Jordan\t14\t14\t0
10\tKarl Malone\t14\t14\t0
11\tDirk Nowitzki\t14\t14\t0
12\tJerry West\t14\t14\t0
13\tWilt Chamberlain\t13\t13\t0
14\tBob Cousy\t13\t13\t0
15\tJohn Havlicek\t13\t13\t0
16\tMoses Malone\t13\t12\t1
17\tDwyane Wade\t13\t13\t0
18\tRick Barry\t12\t8\t4
19\tLarry Bird\t12\t12\t0
20\tStephen Curry\t12\t12\t0
21\tGeorge Gervin\t12\t9\t3
22\tElvin Hayes\t12\t12\t0
23\tMagic Johnson\t12\t12\t0
24\tHakeem Olajuwon\t12\t12\t0
25\tChris Paul\t12\t12\t0
26\tOscar Robertson\t12\t12\t0
27\tBill Russell\t12\t12\t0
28\tDolph Schayes\t12\t12\t0
29\tIsiah Thomas\t12\t12\t0
30\tCharles Barkley\t11\t11\t0
31\tElgin Baylor\t11\t11\t0
32\tChris Bosh\t11\t11\t0
33\tPatrick Ewing\t11\t11\t0
34\tArtis Gilmore\t11\t6\t5
35\tJames Harden\t11\t11\t0
36\tAllen Iverson\t11\t11\t0
37\tBob Pettit\t11\t11\t0
38\tRay Allen\t10\t10\t0
39\tGiannis Antetokounmpo\t10\t10\t0
40\tCarmelo Anthony\t10\t10\t0
41\tPaul Arizin\t10\t10\t0
42\tAnthony Davis\t10\t10\t0
43\tClyde Drexler\t10\t10\t0
44\tHal Greer\t10\t10\t0
45\tJason Kidd\t10\t10\t0
46\tPaul Pierce\t10\t10\t0
47\tDavid Robinson\t10\t10\t0
48\tJohn Stockton\t10\t10\t0
49\tPaul George\t9\t9\t0
50\tKyrie Irving\t9\t9\t0
51\tDamian Lillard\t9\t9\t0
52\tRobert Parish\t9\t9\t0
53\tGary Payton\t9\t9\t0
54\tRussell Westbrook\t9\t9\t0
55\tLenny Wilkens\t9\t9\t0
56\tDominique Wilkins\t9\t9\t0
57\tVince Carter\t8\t8\t0
58\tDave Cowens\t8\t8\t0
59\tDave DeBusschere\t8\t8\t0
60\tAlex English\t8\t8\t0
61\tLarry Foust\t8\t8\t0
62\tDwight Howard\t8\t8\t0
63\tNikola Jokić\t8\t8\t0
64\tBob Lanier\t8\t8\t0
65\tYao Ming\t8\t8\t0
66\tDikembe Mutombo\t8\t8\t0
67\tSteve Nash\t8\t8\t0
68\tBill Sharman\t8\t8\t0
69\tLaMarcus Aldridge\t7\t7\t0
70\tDave Bing\t7\t7\t0
71\tLouie Dampier\t7\t0\t7
72\tMel Daniels\t7\t0\t7
73\tJoel Embiid\t7\t7\t0
74\tWalt Frazier\t7\t7\t0
75\tHarry Gallatin\t7\t7\t0
76\tGrant Hill\t7\t7\t0
77\tDan Issel\t7\t1\t6
78\tJoe Johnson\t7\t7\t0
79\tKawhi Leonard\t7\t7\t0
80\tJerry Lucas\t7\t7\t0
81\tEd Macauley\t7\t7\t0
82\tSlater Martin\t7\t7\t0
83\tTracy McGrady\t7\t7\t0
84\tDick McGuire\t7\t7\t0
85\tKevin McHale\t7\t7\t0
86\tDonovan Mitchell\t7\t7\t0
87\tAlonzo Mourning\t7\t7\t0
88\tScottie Pippen\t7\t7\t0
89\tWillis Reed\t7\t7\t0
90\tJack Sikma\t7\t7\t0
91\tNate Thurmond\t7\t7\t0
92\tChet Walker\t7\t7\t0
93\tJo Jo White\t7\t7\t0
94\tJames Worthy\t7\t7\t0
95\tTiny Archibald\t6\t6\t0
96\tJimmy Butler\t6\t6\t0
97\tLarry Costello\t6\t6\t0
98\tAdrian Dantley\t6\t6\t0
99\tWalter Davis\t6\t6\t0
100\tDeMar DeRozan\t6\t6\t0
101\tLuka Dončić\t6\t6\t0
102\tJoe Dumars\t6\t6\t0
103\tPau Gasol\t6\t6\t0
104\tBlake Griffin\t6\t6\t0
105\tRichie Guerin\t6\t6\t0
106\tCliff Hagan\t6\t5\t1
107\tConnie Hawkins\t6\t4\t2
108\tTom Heinsohn\t6\t6\t0
109\tBailey Howell\t6\t6\t0
110\tLou Hudson\t6\t6\t0
111\tNeil Johnston\t6\t6\t0
112\tJimmy Jones\t6\t0\t6
113\tShawn Kemp\t6\t6\t0
114\tKyle Lowry\t6\t6\t0
115\tGeorge McGinnis\t6\t3\t3
116\tVern Mikkelsen\t6\t6\t0
117\tJermaine O'Neal\t6\t6\t0
118\tTony Parker\t6\t6\t0
119\tMitch Richmond\t6\t6\t0
120\tAmar'e Stoudemire\t6\t6\t0
121\tJayson Tatum\t6\t6\t0
122\tKarl-Anthony Towns\t6\t6\t0
123\tJack Twyman\t6\t6\t0
124\tGeorge Yardley\t6\t6\t0
125\tZelmo Beaty\t5\t2\t3
126\tChauncey Billups\t5\t5\t0
127\tDevin Booker\t5\t5\t0
128\tCarl Braun\t5\t5\t0
129\tJaylen Brown\t5\t5\t0
130\tMack Calvin\t5\t0\t5
131\tBilly Cunningham\t5\t4\t1
132\tBrad Daugherty\t5\t5\t0
133\tWayne Embry\t5\t5\t0
134\tDonnie Freeman\t5\t0\t5
135\tTom Gola\t5\t5\t0
136\tGail Goodrich\t5\t5\t0
137\tTim Hardaway\t5\t5\t0
138\tSpencer Haywood\t5\t4\t1
139\tAl Horford\t5\t5\t0
140\tDennis Johnson\t5\t5\t0
141\tGus Johnson\t5\t5\t0
142\tMarques Johnson\t5\t5\t0
143\tBobby Jones\t5\t4\t1
144\tSam Jones\t5\t5\t0
145\tLarry Kenon\t5\t2\t3
146\tRudy LaRusso\t5\t5\t0
147\tKevin Love\t5\t5\t0
148\tMaurice Lucas\t5\t4\t1
149\tPete Maravich\t5\t5\t0
150\tBob McAdoo\t5\t5\t0
151\tReggie Miller\t5\t5\t0
152\tSidney Moncrief\t5\t5\t0
153\tChris Mullin\t5\t5\t0
154\tDon Ohl\t5\t5\t0
155\tAndy Phillip\t5\t5\t0
156\tCharlie Scott\t5\t3\t2
157\tGene Shue\t5\t5\t0
158\tRalph Simpson\t5\t0\t5
159\tDavid Thompson\t5\t4\t1
160\tKlay Thompson\t5\t5\t0
161\tRudy Tomjanovich\t5\t5\t0
162\tWes Unseld\t5\t5\t0
163\tJohn Wall\t5\t5\t0
164\tBobby Wanzer\t5\t5\t0
165\tChris Webber\t5\t5\t0
166\tPaul Westphal\t5\t5\t0
167\tVin Baker\t4\t4\t0
168\tWalt Bellamy\t4\t4\t0
169\tOtis Birdsong\t4\t4\t0
170\tRolando Blackman\t4\t4\t0
171\tRon Boone\t4\t0\t4
172\tRoger Brown\t4\t0\t4
173\tJoe Caldwell\t4\t2\t2
174\tTom Chambers\t4\t4\t0
175\tMaurice Cheeks\t4\t4\t0
176\tDoug Collins\t4\t4\t0
177\tDeMarcus Cousins\t4\t4\t0
178\tBob Dandridge\t4\t4\t0
179\tBob Davies\t4\t4\t0
180\tAnthony Edwards\t4\t4\t0
181\tDick Garmaker\t4\t4\t0
182\tShai Gilgeous-Alexander\t4\t4\t0
183\tDraymond Green\t4\t4\t0
184\tJohnny Green\t4\t4\t0
185\tAnfernee Hardaway\t4\t4\t0
186\tMel Hutchins\t4\t4\t0
187\tWarren Jabali\t4\t0\t4
188\tLarry Jones\t4\t0\t4
189\tBernard King\t4\t4\t0
190\tBill Laimbeer\t4\t4\t0
191\tClyde Lovellette\t4\t4\t0
192\tShawn Marion\t4\t4\t0
193\tGeorge Mikan\t4\t4\t0
194\tPaul Millsap\t4\t4\t0
195\tEarl Monroe\t4\t4\t0
196\tWillie Naulls\t4\t4\t0
197\tBob Netolicky\t4\t0\t4
198\tBilly Paultz\t4\t0\t4
199\tJim Pollard\t4\t4\t0
200\tMark Price\t4\t4\t0
201\tMichael Ray Richardson\t4\t4\t0
202\tArnie Risen\t4\t4\t0
203\tRed Robbins\t4\t0\t4
204\tAlvin Robertson\t4\t4\t0
205\tGuy Rodgers\t4\t4\t0
206\tRajon Rondo\t4\t4\t0
207\tRalph Sampson\t4\t4\t0
208\tPascal Siakam\t4\t4\t0
209\tLatrell Sprewell\t4\t4\t0
210\tKemba Walker\t4\t4\t0
211\tBen Wallace\t4\t4\t0
212\tRasheed Wallace\t4\t4\t0
213\tSidney Wicks\t4\t4\t0
214\tTrae Young\t4\t4\t0
215\tBam Adebayo\t3\t3\t0
216\tMark Aguirre\t3\t3\t0
217\tGilbert Arenas\t3\t3\t0
218\tBradley Beal\t3\t3\t0
219\tJohn Beasley\t3\t0\t3
220\tBill Bridges\t3\t3\t0
221\tLarry Brown\t3\t0\t3
222\tJalen Brunson\t3\t3\t0
223\tDarel Carrier\t3\t0\t3
224\tPhil Chenier\t3\t3\t0
225\tGlen Combs\t3\t0\t3
226\tTerry Dischinger\t3\t3\t0
227\tSteve Francis\t3\t3\t0
228\tMarc Gasol\t3\t3\t0
229\tRudy Gobert\t3\t3\t0
230\tRichard Hamilton\t3\t3\t0
231\tKevin Johnson\t3\t3\t0
232\tStew Johnson\t3\t0\t3
233\tEddie Jones\t3\t3\t0
234\tSteve Jones\t3\t0\t3
235\tBob Kauffman\t3\t3\t0
236\tRed Kerr\t3\t3\t0
237\tBilly Knight\t3\t2\t1
238\tFreddie Lewis\t3\t0\t3
239\tBob Love\t3\t3\t0
240\tDan Majerle\t3\t3\t0
241\tBill Melchionni\t3\t0\t3
242\tKhris Middleton\t3\t3\t0
243\tDoug Moe\t3\t0\t3
244\tJeff Mullins\t3\t3\t0
245\tLarry Nance\t3\t3\t0
246\tJulius Randle\t3\t3\t0
247\tGlen Rice\t3\t3\t0
248\tDerrick Rose\t3\t3\t0
249\tDan Roundfield\t3\t3\t0
250\tBrandon Roy\t3\t3\t0
251\tDomantas Sabonis\t3\t3\t0
252\tDetlef Schrempf\t3\t3\t0
253\tPaul Seymour\t3\t3\t0
254\tBen Simmons\t3\t3\t0
255\tPeja Stojaković\t3\t3\t0
256\tMaurice Stokes\t3\t3\t0
257\tGeorge Thompson\t3\t0\t3
258\tDick Van Arsdale\t3\t3\t0
259\tTom Van Arsdale\t3\t3\t0
260\tNorm Van Lier\t3\t3\t0
261\tAntoine Walker\t3\t3\t0
262\tJamaal Wilkes\t3\t3\t0
263\tBuck Williams\t3\t3\t0
264\tDeron Williams\t3\t3\t0
265\tWillie Wise\t3\t0\t3
266\tMarvin Barnes\t2\t0\t2
267\tScottie Barnes\t2\t2\t0
268\tLeo Barnhorst\t2\t2\t0
269\tByron Beck\t2\t0\t2
270\tArt Becker\t2\t0\t2
271\tCarlos Boozer\t2\t2\t0
272\tElton Brand\t2\t2\t0
273\tTerrell Brandon\t2\t2\t0
274\tFrankie Brian\t2\t2\t0
275\tJohn Brisker\t2\t0\t2
276\tDon Buse\t2\t1\t1
277\tCaron Butler\t2\t2\t0
278\tArchie Clark\t2\t2\t0
279\tTerry Cummings\t2\t2\t0
280\tCade Cunningham\t2\t2\t0
281\tBaron Davis\t2\t2\t0
282\tWarren Davis\t2\t0\t2
283\tLuol Deng\t2\t2\t0
284\tJohn Drew\t2\t2\t0
285\tAndre Drummond\t2\t2\t0
286\tKevin Duckworth\t2\t2\t0
287\tWalter Dukes\t2\t2\t0
288\tDike Eddleman\t2\t2\t0
289\tSean Elliott\t2\t2\t0
290\tMichael Finley\t2\t2\t0
291\tDe'Aaron Fox\t2\t2\t0
292\tJoe Fulks\t2\t2\t0
293\tDarius Garland\t2\t2\t0
294\tJack George\t2\t2\t0
295\tManu Ginóbili\t2\t2\t0
296\tTyrese Haliburton\t2\t2\t0
297\tRoy Hibbert\t2\t2\t0
298\tJrue Holiday\t2\t2\t0
299\tAllan Houston\t2\t2\t0
300\tHot Rod Hundley\t2\t2\t0
301\tLes Hunter\t2\t0\t2
302\tZydrunas Ilgauskas\t2\t2\t0
303\tBrandon Ingram\t2\t2\t0
304\tJaren Jackson Jr.\t2\t2\t0
305\tAntawn Jamison\t2\t2\t0
306\tEddie Johnson\t2\t2\t0
307\tJohn Johnson\t2\t2\t0
308\tLarry Johnson\t2\t2\t0
309\tRich Jones\t2\t0\t2
310\tDon Kojis\t2\t2\t0
311\tWendell Ladner\t2\t0\t2
312\tZach LaVine\t2\t2\t0
313\tDavid Lee\t2\t2\t0
314\tFat Lever\t2\t2\t0
315\tMike Lewis\t2\t0\t2
316\tRashard Lewis\t2\t2\t0
317\tJeff Malone\t2\t2\t0
318\tDanny Manning\t2\t2\t0
319\tStephon Marbury\t2\t2\t0
320\tJack Marin\t2\t2\t0
321\tTyrese Maxey\t2\t2\t0
322\tBrad Miller\t2\t2\t0
323\tJa Morant\t2\t2\t0
324\tSwen Nater\t2\t0\t2
325\tNorm Nixon\t2\t2\t0
326\tJoakim Noah\t2\t2\t0
327\tVictor Oladipo\t2\t2\t0
328\tJim Paxson\t2\t2\t0
329\tGeoff Petrie\t2\t2\t0
330\tTerry Porter\t2\t2\t0
331\tCincy Powell\t2\t0\t2
332\tZach Randolph\t2\t2\t0
333\tGlenn Robinson\t2\t2\t0
334\tTruck Robinson\t2\t2\t0
335\tRed Rocha\t2\t2\t0
336\tDennis Rodman\t2\t2\t0
337\tJeff Ruland\t2\t2\t0
338\tFred Scolari\t2\t2\t0
339\tKenny Sears\t2\t2\t0
340\tFrank Selvy\t2\t2\t0
341\tAlperen Şengün\t2\t2\t0
342\tJames Silas\t2\t0\t2
343\tPaul Silas\t2\t2\t0
344\tJerry Sloan\t2\t2\t0
345\tPhil Smith\t2\t2\t0
346\tRandy Smith\t2\t2\t0
347\tJerry Stackhouse\t2\t2\t0
348\tLevern Tart\t2\t0\t2
349\tBrian Taylor\t2\t0\t2
350\tReggie Theus\t2\t2\t0
351\tIsaiah Thomas\t2\t2\t0
352\tAndrew Toney\t2\t2\t0
353\tKelly Tripucka\t2\t2\t0
354\tKiki Vandeweghe\t2\t2\t0
355\tBob Verga\t2\t0\t2
356\tNikola Vučević\t2\t2\t0
357\tJimmy Walker\t2\t2\t0
358\tBill Walton\t2\t2\t0
359\tScott Wedman\t2\t2\t0
360\tVictor Wembanyama\t2\t2\t0
361\tDavid West\t2\t2\t0
362\tCharlie Williams\t2\t0\t2
363\tChuck Williams\t2\t0\t2
364\tGus Williams\t2\t2\t0
365\tZion Williamson\t2\t2\t0
366\tBrian Winters\t2\t2\t0
367\tShareef Abdur-Rahim\t1\t1\t0
368\tAlvan Adams\t1\t1\t0
369\tMichael Adams\t1\t1\t0
370\tDanny Ainge\t1\t1\t0
371\tJarrett Allen\t1\t1\t0
372\tKenny Anderson\t1\t1\t0
373\tB.J. Armstrong\t1\t1\t0
374\tDeni Avdija\t1\t1\t0
375\tLaMelo Ball\t1\t1\t0
376\tPaolo Banchero\t1\t1\t0
377\tDon Barksdale\t1\t1\t0
378\tDick Barnett\t1\t1\t0
379\tDana Barros\t1\t1\t0
380\tButch Beard\t1\t1\t0
381\tRalph Beard\t1\t1\t0
382\tMookie Blaylock\t1\t1\t0
383\tJohn Block\t1\t1\t0
384\tBob Boozer\t1\t1\t0
385\tVince Boryla\t1\t1\t0
386\tBill Bradley\t1\t1\t0
387\tFred Brown\t1\t1\t0
388\tRoger Brown\t1\t0\t1
389\tLarry Bunce\t1\t0\t1
390\tAndrew Bynum\t1\t1\t0
391\tAustin Carr\t1\t1\t0
392\tJoe Barry Carroll\t1\t1\t0
393\tGeorge Carter\t1\t0\t1
394\tBill Cartwright\t1\t1\t0
395\tSam Cassell\t1\t1\t0
396\tCedric Ceballos\t1\t1\t0
397\tTyson Chandler\t1\t1\t0
398\tLen Chappell\t1\t1\t0
399\tNat Clifton\t1\t1\t0
400\tDerrick Coleman\t1\t1\t0
401\tJack Coleman\t1\t1\t0
402\tMike Conley\t1\t1\t0
403\tAntonio Davis\t1\t1\t0
404\tDale Davis\t1\t1\t0
405\tVlade Divac\t1\t1\t0
406\tJames Donaldson\t1\t1\t0
407\tGoran Dragić\t1\t1\t0
408\tJalen Duren\t1\t1\t0
409\tJim Eakins\t1\t0\t1
410\tMark Eaton\t1\t1\t0
411\tDale Ellis\t1\t1\t0
412\tRay Felix\t1\t1\t0
413\tSleepy Floyd\t1\t1\t0
414\tJimmy Foster\t1\t0\t1
415\tWorld B. Free\t1\t1\t0
416\tBill Gabor\t1\t1\t0
417\tChris Gatling\t1\t1\t0
418\tGus Gerard\t1\t0\t1
419\tGerald Govan\t1\t0\t1
420\tDanny Granger\t1\t1\t0
421\tHorace Grant\t1\t1\t0
422\tA.C. Green\t1\t1\t0
423\tMike Green\t1\t0\t1
424\tRickey Green\t1\t1\t0
425\tAlex Groza\t1\t1\t0
426\tTom Gugliotta\t1\t1\t0
427\tDevin Harris\t1\t1\t0
428\tBob Harrison\t1\t1\t0
429\tHersey Hawkins\t1\t1\t0
430\tGordon Hayward\t1\t1\t0
431\tWalt Hazzard\t1\t1\t0
432\tTyler Herro\t1\t1\t0
433\tArt Heyman\t1\t0\t1
434\tWayne Hightower\t1\t0\t1
435\tTyrone Hill\t1\t1\t0
436\tLionel Hollins\t1\t1\t0
437\tChet Holmgren\t1\t1\t0
438\tJeff Hornacek\t1\t1\t0
439\tJosh Howard\t1\t1\t0
440\tJuwan Howard\t1\t1\t0
441\tAndre Iguodala\t1\t1\t0
442\tDarrall Imhoff\t1\t1\t0
443\tLuke Jackson\t1\t1\t0
444\tMark Jackson\t1\t1\t0
445\tMerv Jackson\t1\t0\t1
446\tTony Jackson\t1\t0\t1
447\tJalen Johnson\t1\t1\t0
448\tNeil Johnson\t1\t0\t1
449\tSteve Johnson\t1\t1\t0
450\tCaldwell Jones\t1\t0\t1
451\tWil Jones\t1\t0\t1
452\tDeAndre Jordan\t1\t1\t0
453\tChris Kaman\t1\t1\t0
454\tJulius Keye\t1\t0\t1
455\tJim King\t1\t1\t0
456\tAndrei Kirilenko\t1\t1\t0
457\tKyle Korver\t1\t1\t0
458\tSam Lacey\t1\t1\t0
459\tChristian Laettner\t1\t1\t0
460\tClyde Lee\t1\t1\t0
461\tReggie Lewis\t1\t1\t0
462\tGoose Ligon\t1\t0\t1
463\tBrook Lopez\t1\t1\t0
464\tJamaal Magloire\t1\t1\t0
465\tRandy Mahaffey\t1\t0\t1
466\tLauri Markkanen\t1\t1\t0
467\tKenyon Martin\t1\t1\t0
468\tJamal Mashburn\t1\t1\t0
469\tAnthony Mason\t1\t1\t0
470\tTed McClain\t1\t0\t1
471\tXavier McDaniel\t1\t1\t0
472\tJim McDaniels\t1\t0\t1
473\tAntonio McDyess\t1\t1\t0
474\tJon McGlocklin\t1\t1\t0
475\tDewitt Menyard\t1\t0\t1
476\tTom Meschery\t1\t1\t0
477\tEddie Miles\t1\t1\t0
478\tMike Mitchell\t1\t1\t0
479\tSteve Mix\t1\t1\t0
480\tEvan Mobley\t1\t1\t0
481\tJack Molinas\t1\t1\t0
482\tGene Moore\t1\t0\t1
483\tCalvin Murphy\t1\t1\t0
484\tDejounte Murray\t1\t1\t0
485\tJamal Murray\t1\t1\t0
486\tCalvin Natt\t1\t1\t0
487\tJameer Nelson\t1\t1\t0
488\tChuck Noble\t1\t1\t0
489\tCharles Oakley\t1\t1\t0
490\tMehmet Okur\t1\t1\t0
491\tRicky Pierce\t1\t1\t0
492\tKristaps Porziņģis\t1\t1\t0
493\tNorman Powell\t1\t1\t0
494\tJim Price\t1\t1\t0
495\tTheo Ratliff\t1\t1\t0
496\tMichael Redd\t1\t1\t0
497\tRichie Regan\t1\t1\t0
498\tDoc Rivers\t1\t1\t0
499\tClifford Robinson\t1\t1\t0
500\tFlynn Robinson\t1\t1\t0
501\tCurtis Rowe\t1\t1\t0
502\tBob Rule\t1\t1\t0
503\tCampy Russell\t1\t1\t0
504\tCazzie Russell\t1\t1\t0
505\tD'Angelo Russell\t1\t1\t0
506\tWoody Sauldsberry\t1\t1\t0
507\tFred Schaus\t1\t1\t0
508\tLee Shaffer\t1\t1\t0
509\tLonnie Shelton\t1\t1\t0
510\tWalt Simon\t1\t0\t1
511\tAdrian Smith\t1\t1\t0
512\tSteve Smith\t1\t1\t0
513\tRik Smits\t1\t1\t0
514\tWillie Somerset\t1\t0\t1
515\tJohn Starks\t1\t1\t0
516\tDon Sunderlage\t1\t1\t0
517\tWally Szczerbiak\t1\t1\t0
518\tJeff Teague\t1\t1\t0
519\tClaude Terry\t1\t0\t1
520\tSkip Thoren\t1\t0\t1
521\tOtis Thorpe\t1\t1\t0
522\tMonte Towe\t1\t0\t1
523\tDave Twardzik\t1\t0\t1
524\tNick Van Exel\t1\t1\t0
525\tFred VanVleet\t1\t1\t0
526\tChico Vaughn\t1\t0\t1
527\tGerald Wallace\t1\t1\t0
528\tPaul Walther\t1\t1\t0
529\tBen Warley\t1\t0\t1
530\tKermit Washington\t1\t1\t0
531\tTrooper Washington\t1\t0\t1
532\tAndrew Wiggins\t1\t1\t0
533\tJalen Williams\t1\t1\t0
534\tJayson Williams\t1\t1\t0
535\tMo Williams\t1\t1\t0
536\tKevin Willis\t1\t1\t0
537\tMetta World Peace\t1\t1\t0
538\tMax Zaslofsky\t1\t1\t0
`;

function parseAllStarDataset(text) {
  const names = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('Rk')) continue;

    // Accept either tab-separated or space-separated rows; name can contain spaces.
    // We capture the last 3 numeric columns as Tot/NBA/ABA.
    const m = trimmed.match(/^\s*\d+\s+(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/);
    if (!m) continue;
    const rawName = m[1];
    const nba = Number(m[3]);
    if (!Number.isFinite(nba) || nba <= 0) continue; // exclude ABA-only selections

    const cleanedName = rawName
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[†‡§\*\^]+/g, ''); // safety: strip footnote markers if present

    if (cleanedName) names.push(cleanedName);
  }
  return names;
}

const _allParsed = parseAllStarDataset(ALL_STAR_DATASET);
// Only 1986+ All-Stars: exclude anyone whose last All-Star was before 1986
export const NBA_ALL_STAR_NAMES = _allParsed.filter(
  (name) => !LAST_ALL_STAR_BEFORE_1986_KEYS.has(normalizePlayerName(name))
);
export const NBA_ALL_STAR_NAME_KEYS = new Set(NBA_ALL_STAR_NAMES.map(normalizePlayerName));

export function isAllStarPlayerName(playerName) {
  return NBA_ALL_STAR_NAME_KEYS.has(normalizePlayerName(playerName));
}
