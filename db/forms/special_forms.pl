:- encoding(utf8).
% Formas especiais locais (Mega e regionais)
% Formato: pokemon(ID, Nome, Altura, Peso, Tipos, Habilidades, Stats).
% Mapeamento: pokemon_form_base(FormID, BaseSpeciesID).
% Tipo da forma: pokemon_form_kind(FormID, Kind).
:- multifile pokemon/7.
:- multifile pokemon_form_base/2.
:- multifile pokemon_form_kind/2.
pokemon(10033, venusaur_mega, 24, 1555, [grass, poison], [thick_fat], [attack-100, defense-123, hp-80, special_attack-122, special_defense-120, speed-80]).
pokemon_form_base(10033, 3).
pokemon_form_kind(10033, mega).
pokemon(10034, charizard_mega_x, 17, 1105, [fire, dragon], [tough_claws], [attack-130, defense-111, hp-78, special_attack-130, special_defense-85, speed-100]).
pokemon_form_base(10034, 6).
pokemon_form_kind(10034, mega).
pokemon(10035, charizard_mega_y, 17, 1005, [fire, flying], [drought], [attack-104, defense-78, hp-78, special_attack-159, special_defense-115, speed-100]).
pokemon_form_base(10035, 6).
pokemon_form_kind(10035, mega).
pokemon(10036, blastoise_mega, 16, 1011, [water], [mega_launcher], [attack-103, defense-120, hp-79, special_attack-135, special_defense-115, speed-78]).
pokemon_form_base(10036, 9).
pokemon_form_kind(10036, mega).
pokemon(10037, alakazam_mega, 12, 480, [psychic], [trace], [attack-50, defense-65, hp-55, special_attack-175, special_defense-105, speed-150]).
pokemon_form_base(10037, 65).
pokemon_form_kind(10037, mega).
pokemon(10038, gengar_mega, 14, 405, [ghost, poison], [shadow_tag], [attack-65, defense-80, hp-60, special_attack-170, special_defense-95, speed-130]).
pokemon_form_base(10038, 94).
pokemon_form_kind(10038, mega).
pokemon(10039, kangaskhan_mega, 22, 1000, [normal], [parental_bond], [attack-125, defense-100, hp-105, special_attack-60, special_defense-100, speed-100]).
pokemon_form_base(10039, 115).
pokemon_form_kind(10039, mega).
pokemon(10040, pinsir_mega, 17, 590, [bug, flying], [aerilate], [attack-155, defense-120, hp-65, special_attack-65, special_defense-90, speed-105]).
pokemon_form_base(10040, 127).
pokemon_form_kind(10040, mega).
pokemon(10041, gyarados_mega, 65, 3050, [water, dark], [mold_breaker], [attack-155, defense-109, hp-95, special_attack-70, special_defense-130, speed-81]).
pokemon_form_base(10041, 130).
pokemon_form_kind(10041, mega).
pokemon(10042, aerodactyl_mega, 21, 790, [rock, flying], [tough_claws], [attack-135, defense-85, hp-80, special_attack-70, special_defense-95, speed-150]).
pokemon_form_base(10042, 142).
pokemon_form_kind(10042, mega).
pokemon(10043, mewtwo_mega_x, 23, 1270, [psychic, fighting], [steadfast], [attack-190, defense-100, hp-106, special_attack-154, special_defense-100, speed-130]).
pokemon_form_base(10043, 150).
pokemon_form_kind(10043, mega).
pokemon(10044, mewtwo_mega_y, 15, 330, [psychic], [insomnia], [attack-150, defense-70, hp-106, special_attack-194, special_defense-120, speed-140]).
pokemon_form_base(10044, 150).
pokemon_form_kind(10044, mega).
pokemon(10045, ampharos_mega, 14, 615, [electric, dragon], [mold_breaker], [attack-95, defense-105, hp-90, special_attack-165, special_defense-110, speed-45]).
pokemon_form_base(10045, 181).
pokemon_form_kind(10045, mega).
pokemon(10046, scizor_mega, 20, 1250, [bug, steel], [technician], [attack-150, defense-140, hp-70, special_attack-65, special_defense-100, speed-75]).
pokemon_form_base(10046, 212).
pokemon_form_kind(10046, mega).
pokemon(10047, heracross_mega, 17, 625, [bug, fighting], [skill_link], [attack-185, defense-115, hp-80, special_attack-40, special_defense-105, speed-75]).
pokemon_form_base(10047, 214).
pokemon_form_kind(10047, mega).
pokemon(10048, houndoom_mega, 19, 495, [dark, fire], [solar_power], [attack-90, defense-90, hp-75, special_attack-140, special_defense-90, speed-115]).
pokemon_form_base(10048, 229).
pokemon_form_kind(10048, mega).
pokemon(10049, tyranitar_mega, 25, 2550, [rock, dark], [sand_stream], [attack-164, defense-150, hp-100, special_attack-95, special_defense-120, speed-71]).
pokemon_form_base(10049, 248).
pokemon_form_kind(10049, mega).
pokemon(10050, blaziken_mega, 19, 520, [fire, fighting], [speed_boost], [attack-160, defense-80, hp-80, special_attack-130, special_defense-80, speed-100]).
pokemon_form_base(10050, 257).
pokemon_form_kind(10050, mega).
pokemon(10051, gardevoir_mega, 16, 484, [psychic, fairy], [pixilate], [attack-85, defense-65, hp-68, special_attack-165, special_defense-135, speed-100]).
pokemon_form_base(10051, 282).
pokemon_form_kind(10051, mega).
pokemon(10052, mawile_mega, 10, 235, [steel, fairy], [huge_power], [attack-105, defense-125, hp-50, special_attack-55, special_defense-95, speed-50]).
pokemon_form_base(10052, 303).
pokemon_form_kind(10052, mega).
pokemon(10053, aggron_mega, 22, 3950, [steel], [filter], [attack-140, defense-230, hp-70, special_attack-60, special_defense-80, speed-50]).
pokemon_form_base(10053, 306).
pokemon_form_kind(10053, mega).
pokemon(10054, medicham_mega, 13, 315, [fighting, psychic], [pure_power], [attack-100, defense-85, hp-60, special_attack-80, special_defense-85, speed-100]).
pokemon_form_base(10054, 308).
pokemon_form_kind(10054, mega).
pokemon(10055, manectric_mega, 18, 440, [electric], [intimidate], [attack-75, defense-80, hp-70, special_attack-135, special_defense-80, speed-135]).
pokemon_form_base(10055, 310).
pokemon_form_kind(10055, mega).
pokemon(10056, banette_mega, 12, 130, [ghost], [prankster], [attack-165, defense-75, hp-64, special_attack-93, special_defense-83, speed-75]).
pokemon_form_base(10056, 354).
pokemon_form_kind(10056, mega).
pokemon(10057, absol_mega, 12, 490, [dark], [magic_bounce], [attack-150, defense-60, hp-65, special_attack-115, special_defense-60, speed-115]).
pokemon_form_base(10057, 359).
pokemon_form_kind(10057, mega).
pokemon(10058, garchomp_mega, 19, 950, [dragon, ground], [sand_force], [attack-170, defense-115, hp-108, special_attack-120, special_defense-95, speed-92]).
pokemon_form_base(10058, 445).
pokemon_form_kind(10058, mega).
pokemon(10059, lucario_mega, 13, 575, [fighting, steel], [adaptability], [attack-145, defense-88, hp-70, special_attack-140, special_defense-70, speed-112]).
pokemon_form_base(10059, 448).
pokemon_form_kind(10059, mega).
pokemon(10060, abomasnow_mega, 27, 1850, [grass, ice], [snow_warning], [attack-132, defense-105, hp-90, special_attack-132, special_defense-105, speed-30]).
pokemon_form_base(10060, 460).
pokemon_form_kind(10060, mega).
pokemon(10062, latias_mega, 18, 520, [dragon, psychic], [levitate], [attack-100, defense-120, hp-80, special_attack-140, special_defense-150, speed-110]).
pokemon_form_base(10062, 380).
pokemon_form_kind(10062, mega).
pokemon(10063, latios_mega, 23, 700, [dragon, psychic], [levitate], [attack-130, defense-100, hp-80, special_attack-160, special_defense-120, speed-110]).
pokemon_form_base(10063, 381).
pokemon_form_kind(10063, mega).
pokemon(10064, swampert_mega, 19, 1020, [water, ground], [swift_swim], [attack-150, defense-110, hp-100, special_attack-95, special_defense-110, speed-70]).
pokemon_form_base(10064, 260).
pokemon_form_kind(10064, mega).
pokemon(10065, sceptile_mega, 19, 552, [grass, dragon], [lightning_rod], [attack-110, defense-75, hp-70, special_attack-145, special_defense-85, speed-145]).
pokemon_form_base(10065, 254).
pokemon_form_kind(10065, mega).
pokemon(10066, sableye_mega, 5, 1610, [dark, ghost], [magic_bounce], [attack-85, defense-125, hp-50, special_attack-85, special_defense-115, speed-20]).
pokemon_form_base(10066, 302).
pokemon_form_kind(10066, mega).
pokemon(10067, altaria_mega, 15, 206, [dragon, fairy], [pixilate], [attack-110, defense-110, hp-75, special_attack-110, special_defense-105, speed-80]).
pokemon_form_base(10067, 334).
pokemon_form_kind(10067, mega).
pokemon(10068, gallade_mega, 16, 564, [psychic, fighting], [inner_focus], [attack-165, defense-95, hp-68, special_attack-65, special_defense-115, speed-110]).
pokemon_form_base(10068, 475).
pokemon_form_kind(10068, mega).
pokemon(10069, audino_mega, 15, 320, [normal, fairy], [healer], [attack-60, defense-126, hp-103, special_attack-80, special_defense-126, speed-50]).
pokemon_form_base(10069, 531).
pokemon_form_kind(10069, mega).
pokemon(10070, sharpedo_mega, 25, 1303, [water, dark], [strong_jaw], [attack-140, defense-70, hp-70, special_attack-110, special_defense-65, speed-105]).
pokemon_form_base(10070, 319).
pokemon_form_kind(10070, mega).
pokemon(10071, slowbro_mega, 20, 1200, [water, psychic], [shell_armor], [attack-75, defense-180, hp-95, special_attack-130, special_defense-80, speed-30]).
pokemon_form_base(10071, 80).
pokemon_form_kind(10071, mega).
pokemon(10072, steelix_mega, 105, 7400, [steel, ground], [sand_force], [attack-125, defense-230, hp-75, special_attack-55, special_defense-95, speed-30]).
pokemon_form_base(10072, 208).
pokemon_form_kind(10072, mega).
pokemon(10073, pidgeot_mega, 22, 505, [normal, flying], [no_guard], [attack-80, defense-80, hp-83, special_attack-135, special_defense-80, speed-121]).
pokemon_form_base(10073, 18).
pokemon_form_kind(10073, mega).
pokemon(10074, glalie_mega, 21, 3502, [ice], [refrigerate], [attack-120, defense-80, hp-80, special_attack-120, special_defense-80, speed-100]).
pokemon_form_base(10074, 362).
pokemon_form_kind(10074, mega).
pokemon(10075, diancie_mega, 11, 278, [rock, fairy], [magic_bounce], [attack-160, defense-110, hp-50, special_attack-160, special_defense-110, speed-110]).
pokemon_form_base(10075, 719).
pokemon_form_kind(10075, mega).
pokemon(10076, metagross_mega, 25, 9429, [steel, psychic], [tough_claws], [attack-145, defense-150, hp-80, special_attack-105, special_defense-110, speed-110]).
pokemon_form_base(10076, 376).
pokemon_form_kind(10076, mega).
pokemon(10079, rayquaza_mega, 108, 3920, [dragon, flying], [delta_stream], [attack-180, defense-100, hp-105, special_attack-180, special_defense-100, speed-115]).
pokemon_form_base(10079, 384).
pokemon_form_kind(10079, mega).
pokemon(10087, camerupt_mega, 25, 3205, [fire, ground], [sheer_force], [attack-120, defense-100, hp-70, special_attack-145, special_defense-105, speed-20]).
pokemon_form_base(10087, 323).
pokemon_form_kind(10087, mega).
pokemon(10088, lopunny_mega, 13, 283, [normal, fighting], [scrappy], [attack-136, defense-94, hp-65, special_attack-54, special_defense-96, speed-135]).
pokemon_form_base(10088, 428).
pokemon_form_kind(10088, mega).
pokemon(10089, salamence_mega, 18, 1126, [dragon, flying], [aerilate], [attack-145, defense-130, hp-95, special_attack-120, special_defense-90, speed-120]).
pokemon_form_base(10089, 373).
pokemon_form_kind(10089, mega).
pokemon(10090, beedrill_mega, 14, 405, [bug, poison], [adaptability], [attack-150, defense-40, hp-65, special_attack-15, special_defense-80, speed-145]).
pokemon_form_base(10090, 15).
pokemon_form_kind(10090, mega).
pokemon(10091, rattata_alola, 3, 38, [dark, normal], [gluttony, hustle, thick_fat], [attack-56, defense-35, hp-30, special_attack-25, special_defense-35, speed-72]).
pokemon_form_base(10091, 19).
pokemon_form_kind(10091, alola).
pokemon(10092, raticate_alola, 7, 255, [dark, normal], [gluttony, hustle, thick_fat], [attack-71, defense-70, hp-75, special_attack-40, special_defense-80, speed-77]).
pokemon_form_base(10092, 20).
pokemon_form_kind(10092, alola).
pokemon(10093, raticate_totem_alola, 14, 1050, [dark, normal], [gluttony, hustle, thick_fat], [attack-71, defense-70, hp-75, special_attack-40, special_defense-80, speed-77]).
pokemon_form_base(10093, 20).
pokemon_form_kind(10093, alola).
pokemon(10100, raichu_alola, 7, 210, [electric, psychic], [surge_surfer], [attack-85, defense-50, hp-60, special_attack-95, special_defense-85, speed-110]).
pokemon_form_base(10100, 26).
pokemon_form_kind(10100, alola).
pokemon(10101, sandshrew_alola, 7, 400, [ice, steel], [snow_cloak, slush_rush], [attack-75, defense-90, hp-50, special_attack-10, special_defense-35, speed-40]).
pokemon_form_base(10101, 27).
pokemon_form_kind(10101, alola).
pokemon(10102, sandslash_alola, 12, 550, [ice, steel], [snow_cloak, slush_rush], [attack-100, defense-120, hp-75, special_attack-25, special_defense-65, speed-65]).
pokemon_form_base(10102, 28).
pokemon_form_kind(10102, alola).
pokemon(10103, vulpix_alola, 6, 99, [ice], [snow_cloak, snow_warning], [attack-41, defense-40, hp-38, special_attack-50, special_defense-65, speed-65]).
pokemon_form_base(10103, 37).
pokemon_form_kind(10103, alola).
pokemon(10104, ninetales_alola, 11, 199, [ice, fairy], [snow_cloak, snow_warning], [attack-67, defense-75, hp-73, special_attack-81, special_defense-100, speed-109]).
pokemon_form_base(10104, 38).
pokemon_form_kind(10104, alola).
pokemon(10105, diglett_alola, 2, 10, [ground, steel], [sand_veil, tangling_hair, sand_force], [attack-55, defense-30, hp-10, special_attack-35, special_defense-45, speed-90]).
pokemon_form_base(10105, 50).
pokemon_form_kind(10105, alola).
pokemon(10106, dugtrio_alola, 7, 666, [ground, steel], [sand_veil, tangling_hair, sand_force], [attack-100, defense-60, hp-35, special_attack-50, special_defense-70, speed-110]).
pokemon_form_base(10106, 51).
pokemon_form_kind(10106, alola).
pokemon(10107, meowth_alola, 4, 42, [dark], [pickup, technician, rattled], [attack-35, defense-35, hp-40, special_attack-50, special_defense-40, speed-90]).
pokemon_form_base(10107, 52).
pokemon_form_kind(10107, alola).
pokemon(10108, persian_alola, 11, 330, [dark], [fur_coat, technician, rattled], [attack-60, defense-60, hp-65, special_attack-75, special_defense-65, speed-115]).
pokemon_form_base(10108, 53).
pokemon_form_kind(10108, alola).
pokemon(10109, geodude_alola, 4, 203, [rock, electric], [magnet_pull, sturdy, galvanize], [attack-80, defense-100, hp-40, special_attack-30, special_defense-30, speed-20]).
pokemon_form_base(10109, 74).
pokemon_form_kind(10109, alola).
pokemon(10110, graveler_alola, 10, 1100, [rock, electric], [magnet_pull, sturdy, galvanize], [attack-95, defense-115, hp-55, special_attack-45, special_defense-45, speed-35]).
pokemon_form_base(10110, 75).
pokemon_form_kind(10110, alola).
pokemon(10111, golem_alola, 17, 3160, [rock, electric], [magnet_pull, sturdy, galvanize], [attack-120, defense-130, hp-80, special_attack-55, special_defense-65, speed-45]).
pokemon_form_base(10111, 76).
pokemon_form_kind(10111, alola).
pokemon(10112, grimer_alola, 7, 420, [poison, dark], [poison_touch, gluttony, power_of_alchemy], [attack-80, defense-50, hp-80, special_attack-40, special_defense-50, speed-25]).
pokemon_form_base(10112, 88).
pokemon_form_kind(10112, alola).
pokemon(10113, muk_alola, 10, 520, [poison, dark], [poison_touch, gluttony, power_of_alchemy], [attack-105, defense-75, hp-105, special_attack-65, special_defense-100, speed-50]).
pokemon_form_base(10113, 89).
pokemon_form_kind(10113, alola).
pokemon(10114, exeggutor_alola, 109, 4156, [grass, dragon], [frisk, harvest], [attack-105, defense-85, hp-95, special_attack-125, special_defense-75, speed-45]).
pokemon_form_base(10114, 103).
pokemon_form_kind(10114, alola).
pokemon(10115, marowak_alola, 10, 340, [fire, ghost], [cursed_body, lightning_rod, rock_head], [attack-80, defense-110, hp-60, special_attack-50, special_defense-80, speed-45]).
pokemon_form_base(10115, 105).
pokemon_form_kind(10115, alola).
pokemon(10161, meowth_galar, 4, 75, [steel], [pickup, tough_claws, unnerve], [attack-65, defense-55, hp-50, special_attack-40, special_defense-40, speed-40]).
pokemon_form_base(10161, 52).
pokemon_form_kind(10161, galar).
pokemon(10162, ponyta_galar, 8, 240, [psychic], [run_away, pastel_veil, anticipation], [attack-85, defense-55, hp-50, special_attack-65, special_defense-65, speed-90]).
pokemon_form_base(10162, 77).
pokemon_form_kind(10162, galar).
pokemon(10163, rapidash_galar, 17, 800, [psychic, fairy], [run_away, pastel_veil, anticipation], [attack-100, defense-70, hp-65, special_attack-80, special_defense-80, speed-105]).
pokemon_form_base(10163, 78).
pokemon_form_kind(10163, galar).
pokemon(10164, slowpoke_galar, 12, 360, [psychic], [gluttony, own_tempo, regenerator], [attack-65, defense-65, hp-90, special_attack-40, special_defense-40, speed-15]).
pokemon_form_base(10164, 79).
pokemon_form_kind(10164, galar).
pokemon(10165, slowbro_galar, 16, 705, [poison, psychic], [quick_draw, own_tempo, regenerator], [attack-100, defense-95, hp-95, special_attack-100, special_defense-70, speed-30]).
pokemon_form_base(10165, 80).
pokemon_form_kind(10165, galar).
pokemon(10166, farfetchd_galar, 8, 420, [fighting], [steadfast, scrappy], [attack-95, defense-55, hp-52, special_attack-58, special_defense-62, speed-55]).
pokemon_form_base(10166, 83).
pokemon_form_kind(10166, galar).
pokemon(10167, weezing_galar, 30, 160, [poison, fairy], [levitate, neutralizing_gas, misty_surge], [attack-90, defense-120, hp-65, special_attack-85, special_defense-70, speed-60]).
pokemon_form_base(10167, 110).
pokemon_form_kind(10167, galar).
pokemon(10168, mr_mime_galar, 14, 568, [ice, psychic], [vital_spirit, screen_cleaner, ice_body], [attack-65, defense-65, hp-50, special_attack-90, special_defense-90, speed-100]).
pokemon_form_base(10168, 122).
pokemon_form_kind(10168, galar).
pokemon(10169, articuno_galar, 17, 509, [psychic, flying], [competitive], [attack-85, defense-85, hp-90, special_attack-125, special_defense-100, speed-95]).
pokemon_form_base(10169, 144).
pokemon_form_kind(10169, galar).
pokemon(10170, zapdos_galar, 16, 582, [fighting, flying], [defiant], [attack-125, defense-90, hp-90, special_attack-85, special_defense-90, speed-100]).
pokemon_form_base(10170, 145).
pokemon_form_kind(10170, galar).
pokemon(10171, moltres_galar, 20, 660, [dark, flying], [berserk], [attack-85, defense-90, hp-90, special_attack-100, special_defense-125, speed-90]).
pokemon_form_base(10171, 146).
pokemon_form_kind(10171, galar).
pokemon(10172, slowking_galar, 18, 795, [poison, psychic], [curious_medicine, own_tempo, regenerator], [attack-65, defense-80, hp-95, special_attack-110, special_defense-110, speed-30]).
pokemon_form_base(10172, 199).
pokemon_form_kind(10172, galar).
pokemon(10173, corsola_galar, 6, 5, [ghost], [weak_armor, cursed_body], [attack-55, defense-100, hp-60, special_attack-65, special_defense-100, speed-30]).
pokemon_form_base(10173, 222).
pokemon_form_kind(10173, galar).
pokemon(10174, zigzagoon_galar, 4, 175, [dark, normal], [pickup, gluttony, quick_feet], [attack-30, defense-41, hp-38, special_attack-30, special_defense-41, speed-60]).
pokemon_form_base(10174, 263).
pokemon_form_kind(10174, galar).
pokemon(10175, linoone_galar, 5, 325, [dark, normal], [pickup, gluttony, quick_feet], [attack-70, defense-61, hp-78, special_attack-50, special_defense-61, speed-100]).
pokemon_form_base(10175, 264).
pokemon_form_kind(10175, galar).
pokemon(10176, darumaka_galar, 7, 400, [ice], [hustle, inner_focus], [attack-90, defense-45, hp-70, special_attack-15, special_defense-45, speed-50]).
pokemon_form_base(10176, 554).
pokemon_form_kind(10176, galar).
pokemon(10179, yamask_galar, 5, 15, [ground, ghost], [wandering_spirit], [attack-55, defense-85, hp-38, special_attack-30, special_defense-65, speed-30]).
pokemon_form_base(10179, 562).
pokemon_form_kind(10179, galar).
pokemon(10180, stunfisk_galar, 7, 205, [ground, steel], [mimicry], [attack-81, defense-99, hp-109, special_attack-66, special_defense-84, speed-32]).
pokemon_form_base(10180, 618).
pokemon_form_kind(10180, galar).
pokemon(10229, growlithe_hisui, 8, 227, [fire, rock], [intimidate, flash_fire, rock_head], [attack-75, defense-45, hp-60, special_attack-65, special_defense-50, speed-55]).
pokemon_form_base(10229, 58).
pokemon_form_kind(10229, hisui).
pokemon(10230, arcanine_hisui, 20, 1680, [fire, rock], [intimidate, flash_fire, rock_head], [attack-115, defense-80, hp-95, special_attack-95, special_defense-80, speed-90]).
pokemon_form_base(10230, 59).
pokemon_form_kind(10230, hisui).
pokemon(10231, voltorb_hisui, 5, 130, [electric, grass], [soundproof, static, aftermath], [attack-30, defense-50, hp-40, special_attack-55, special_defense-55, speed-100]).
pokemon_form_base(10231, 100).
pokemon_form_kind(10231, hisui).
pokemon(10232, electrode_hisui, 12, 710, [electric, grass], [soundproof, static, aftermath], [attack-50, defense-70, hp-60, special_attack-80, special_defense-80, speed-150]).
pokemon_form_base(10232, 101).
pokemon_form_kind(10232, hisui).
pokemon(10233, typhlosion_hisui, 16, 698, [fire, ghost], [blaze, frisk], [attack-84, defense-78, hp-73, special_attack-119, special_defense-85, speed-95]).
pokemon_form_base(10233, 157).
pokemon_form_kind(10233, hisui).
pokemon(10234, qwilfish_hisui, 5, 39, [dark, poison], [poison_point, swift_swim, intimidate], [attack-95, defense-85, hp-65, special_attack-55, special_defense-55, speed-85]).
pokemon_form_base(10234, 211).
pokemon_form_kind(10234, hisui).
pokemon(10235, sneasel_hisui, 9, 270, [fighting, poison], [inner_focus, keen_eye, pickpocket], [attack-95, defense-55, hp-55, special_attack-35, special_defense-75, speed-115]).
pokemon_form_base(10235, 215).
pokemon_form_kind(10235, hisui).
pokemon(10236, samurott_hisui, 15, 582, [water, dark], [torrent, sharpness], [attack-108, defense-80, hp-90, special_attack-100, special_defense-65, speed-85]).
pokemon_form_base(10236, 503).
pokemon_form_kind(10236, hisui).
pokemon(10237, lilligant_hisui, 12, 192, [grass, fighting], [chlorophyll, hustle, leaf_guard], [attack-105, defense-75, hp-70, special_attack-50, special_defense-75, speed-105]).
pokemon_form_base(10237, 549).
pokemon_form_kind(10237, hisui).
pokemon(10238, zorua_hisui, 7, 125, [normal, ghost], [illusion], [attack-60, defense-40, hp-35, special_attack-85, special_defense-40, speed-70]).
pokemon_form_base(10238, 570).
pokemon_form_kind(10238, hisui).
pokemon(10239, zoroark_hisui, 16, 730, [normal, ghost], [illusion], [attack-100, defense-60, hp-55, special_attack-125, special_defense-60, speed-110]).
pokemon_form_base(10239, 571).
pokemon_form_kind(10239, hisui).
pokemon(10240, braviary_hisui, 17, 434, [psychic, flying], [keen_eye, sheer_force, tinted_lens], [attack-83, defense-70, hp-110, special_attack-112, special_defense-70, speed-65]).
pokemon_form_base(10240, 628).
pokemon_form_kind(10240, hisui).
pokemon(10241, sliggoo_hisui, 7, 685, [steel, dragon], [sap_sipper, shell_armor, gooey], [attack-75, defense-83, hp-58, special_attack-83, special_defense-113, speed-40]).
pokemon_form_base(10241, 705).
pokemon_form_kind(10241, hisui).
pokemon(10242, goodra_hisui, 17, 3341, [steel, dragon], [sap_sipper, shell_armor, gooey], [attack-100, defense-100, hp-80, special_attack-110, special_defense-150, speed-60]).
pokemon_form_base(10242, 706).
pokemon_form_kind(10242, hisui).
pokemon(10243, avalugg_hisui, 14, 2624, [ice, rock], [strong_jaw, ice_body, sturdy], [attack-127, defense-184, hp-95, special_attack-34, special_defense-36, speed-38]).
pokemon_form_base(10243, 713).
pokemon_form_kind(10243, hisui).
pokemon(10244, decidueye_hisui, 16, 370, [grass, fighting], [overgrow, scrappy], [attack-112, defense-80, hp-88, special_attack-95, special_defense-95, speed-60]).
pokemon_form_base(10244, 724).
pokemon_form_kind(10244, hisui).
pokemon(10253, wooper_paldea, 4, 110, [poison, ground], [poison_point, water_absorb, unaware], [attack-45, defense-45, hp-55, special_attack-25, special_defense-25, speed-15]).
pokemon_form_base(10253, 194).
pokemon_form_kind(10253, paldea).
pokemon(10278, clefable_mega, 17, 423, [fairy, flying], [magic_bounce], [attack-80, defense-93, hp-95, special_attack-135, special_defense-110, speed-70]).
pokemon_form_base(10278, 36).
pokemon_form_kind(10278, mega).
pokemon(10279, victreebel_mega, 45, 1255, [grass, poison], [innards_out], [attack-125, defense-85, hp-80, special_attack-135, special_defense-95, speed-70]).
pokemon_form_base(10279, 71).
pokemon_form_kind(10279, mega).
pokemon(10280, starmie_mega, 23, 800, [water, psychic], [huge_power], [attack-100, defense-105, hp-60, special_attack-130, special_defense-105, speed-120]).
pokemon_form_base(10280, 121).
pokemon_form_kind(10280, mega).
pokemon(10281, dragonite_mega, 22, 2900, [dragon, flying], [multiscale], [attack-124, defense-115, hp-91, special_attack-145, special_defense-125, speed-100]).
pokemon_form_base(10281, 149).
pokemon_form_kind(10281, mega).
pokemon(10282, meganium_mega, 24, 2010, [grass, fairy], [mega_sol], [attack-92, defense-115, hp-80, special_attack-143, special_defense-115, speed-80]).
pokemon_form_base(10282, 154).
pokemon_form_kind(10282, mega).
pokemon(10283, feraligatr_mega, 23, 1088, [water, dragon], [dragonize], [attack-160, defense-125, hp-85, special_attack-89, special_defense-93, speed-78]).
pokemon_form_base(10283, 160).
pokemon_form_kind(10283, mega).
pokemon(10284, skarmory_mega, 17, 404, [steel, flying], [stalwart], [attack-140, defense-110, hp-65, special_attack-40, special_defense-100, speed-110]).
pokemon_form_base(10284, 227).
pokemon_form_kind(10284, mega).
pokemon(10285, froslass_mega, 26, 296, [ice, ghost], [snow_warning], [attack-80, defense-70, hp-70, special_attack-140, special_defense-100, speed-120]).
pokemon_form_base(10285, 478).
pokemon_form_kind(10285, mega).
pokemon(10286, emboar_mega, 18, 1803, [fire, fighting], [mold_breaker], [attack-148, defense-75, hp-110, special_attack-110, special_defense-110, speed-75]).
pokemon_form_base(10286, 500).
pokemon_form_kind(10286, mega).
pokemon(10287, excadrill_mega, 9, 600, [ground, steel], [piercing_drill], [attack-165, defense-100, hp-110, special_attack-65, special_defense-65, speed-103]).
pokemon_form_base(10287, 530).
pokemon_form_kind(10287, mega).
pokemon(10288, scolipede_mega, 32, 2305, [bug, poison], [], [attack-140, defense-149, hp-60, special_attack-75, special_defense-99, speed-62]).
pokemon_form_base(10288, 545).
pokemon_form_kind(10288, mega).
pokemon(10289, scrafty_mega, 11, 310, [dark, fighting], [], [attack-130, defense-135, hp-65, special_attack-55, special_defense-135, speed-68]).
pokemon_form_base(10289, 560).
pokemon_form_kind(10289, mega).
pokemon(10290, eelektross_mega, 30, 1800, [electric], [], [attack-145, defense-80, hp-85, special_attack-135, special_defense-90, speed-80]).
pokemon_form_base(10290, 604).
pokemon_form_kind(10290, mega).
pokemon(10291, chandelure_mega, 25, 696, [ghost, fire], [infiltrator], [attack-75, defense-110, hp-60, special_attack-175, special_defense-110, speed-90]).
pokemon_form_base(10291, 609).
pokemon_form_kind(10291, mega).
pokemon(10292, chesnaught_mega, 16, 900, [grass, fighting], [bulletproof], [attack-137, defense-172, hp-88, special_attack-74, special_defense-115, speed-44]).
pokemon_form_base(10292, 652).
pokemon_form_kind(10292, mega).
pokemon(10293, delphox_mega, 15, 390, [fire, psychic], [levitate], [attack-69, defense-72, hp-75, special_attack-159, special_defense-125, speed-134]).
pokemon_form_base(10293, 655).
pokemon_form_kind(10293, mega).
pokemon(10294, greninja_mega, 15, 400, [water, dark], [protean], [attack-125, defense-77, hp-72, special_attack-133, special_defense-81, speed-142]).
pokemon_form_base(10294, 658).
pokemon_form_kind(10294, mega).
pokemon(10295, pyroar_mega, 15, 933, [fire, normal], [], [attack-88, defense-92, hp-86, special_attack-129, special_defense-86, speed-126]).
pokemon_form_base(10295, 668).
pokemon_form_kind(10295, mega).
pokemon(10296, floette_mega, 2, 1008, [fairy], [fairy_aura], [attack-85, defense-87, hp-74, special_attack-155, special_defense-148, speed-102]).
pokemon_form_base(10296, 670).
pokemon_form_kind(10296, mega).
pokemon(10297, malamar_mega, 29, 698, [dark, psychic], [], [attack-102, defense-88, hp-86, special_attack-98, special_defense-120, speed-88]).
pokemon_form_base(10297, 687).
pokemon_form_kind(10297, mega).
pokemon(10298, barbaracle_mega, 22, 1000, [rock, fighting], [], [attack-140, defense-130, hp-72, special_attack-64, special_defense-106, speed-88]).
pokemon_form_base(10298, 689).
pokemon_form_kind(10298, mega).
pokemon(10299, dragalge_mega, 21, 1003, [poison, dragon], [], [attack-85, defense-105, hp-65, special_attack-132, special_defense-163, speed-44]).
pokemon_form_base(10299, 691).
pokemon_form_kind(10299, mega).
pokemon(10300, hawlucha_mega, 10, 250, [fighting, flying], [no_guard], [attack-137, defense-100, hp-78, special_attack-74, special_defense-93, speed-118]).
pokemon_form_base(10300, 701).
pokemon_form_kind(10300, mega).
pokemon(10301, zygarde_mega, 77, 6100, [dragon, ground], [], [attack-70, defense-91, hp-216, special_attack-216, special_defense-85, speed-100]).
pokemon_form_base(10301, 718).
pokemon_form_kind(10301, mega).
pokemon(10302, drampa_mega, 30, 2405, [normal, dragon], [berserk], [attack-85, defense-110, hp-78, special_attack-160, special_defense-116, speed-36]).
pokemon_form_base(10302, 780).
pokemon_form_kind(10302, mega).
pokemon(10303, falinks_mega, 16, 990, [fighting], [], [attack-135, defense-135, hp-65, special_attack-70, special_defense-65, speed-100]).
pokemon_form_base(10303, 870).
pokemon_form_kind(10303, mega).
pokemon(10304, raichu_mega_x, 12, 380, [electric], [], [attack-135, defense-95, hp-60, special_attack-90, special_defense-95, speed-110]).
pokemon_form_base(10304, 26).
pokemon_form_kind(10304, mega).
pokemon(10305, raichu_mega_y, 10, 260, [electric], [], [attack-100, defense-55, hp-60, special_attack-160, special_defense-80, speed-130]).
pokemon_form_base(10305, 26).
pokemon_form_kind(10305, mega).
pokemon(10306, chimecho_mega, 12, 80, [psychic, steel], [levitate], [attack-50, defense-110, hp-75, special_attack-135, special_defense-120, speed-65]).
pokemon_form_base(10306, 358).
pokemon_form_kind(10306, mega).
pokemon(10307, absol_mega_z, 12, 490, [dark, ghost], [], [attack-154, defense-60, hp-65, special_attack-75, special_defense-60, speed-151]).
pokemon_form_base(10307, 359).
pokemon_form_kind(10307, mega).
pokemon(10308, staraptor_mega, 19, 500, [fighting, flying], [], [attack-140, defense-100, hp-85, special_attack-60, special_defense-90, speed-110]).
pokemon_form_base(10308, 398).
pokemon_form_kind(10308, mega).
pokemon(10309, garchomp_mega_z, 19, 990, [dragon], [], [attack-130, defense-85, hp-108, special_attack-141, special_defense-85, speed-151]).
pokemon_form_base(10309, 445).
pokemon_form_kind(10309, mega).
pokemon(10310, lucario_mega_z, 13, 494, [fighting, steel], [], [attack-100, defense-70, hp-70, special_attack-164, special_defense-70, speed-151]).
pokemon_form_base(10310, 448).
pokemon_form_kind(10310, mega).
pokemon(10311, heatran_mega, 28, 5700, [fire, steel], [], [attack-120, defense-106, hp-91, special_attack-175, special_defense-141, speed-67]).
pokemon_form_base(10311, 485).
pokemon_form_kind(10311, mega).
pokemon(10312, darkrai_mega, 30, 2400, [dark], [], [attack-120, defense-130, hp-70, special_attack-165, special_defense-130, speed-85]).
pokemon_form_base(10312, 491).
pokemon_form_kind(10312, mega).
pokemon(10313, golurk_mega, 40, 3300, [ground, ghost], [unseen_fist], [attack-159, defense-105, hp-89, special_attack-70, special_defense-105, speed-55]).
pokemon_form_base(10313, 623).
pokemon_form_kind(10313, mega).
pokemon(10314, meowstic_mega, 8, 101, [psychic], [trace], [attack-48, defense-76, hp-74, special_attack-143, special_defense-101, speed-124]).
pokemon_form_base(10314, 678).
pokemon_form_kind(10314, mega).
pokemon(10315, crabominable_mega, 26, 2528, [fighting, ice], [iron_fist], [attack-157, defense-122, hp-97, special_attack-62, special_defense-107, speed-33]).
pokemon_form_base(10315, 740).
pokemon_form_kind(10315, mega).
pokemon(10316, golisopod_mega, 23, 1480, [bug, steel], [], [attack-150, defense-175, hp-75, special_attack-70, special_defense-120, speed-40]).
pokemon_form_base(10316, 768).
pokemon_form_kind(10316, mega).
pokemon(10317, magearna_mega, 13, 2481, [steel, fairy], [], [attack-125, defense-115, hp-80, special_attack-170, special_defense-115, speed-95]).
pokemon_form_base(10317, 801).
pokemon_form_kind(10317, mega).
pokemon(10318, magearna_original_mega, 13, 2481, [steel, fairy], [], [attack-125, defense-115, hp-80, special_attack-170, special_defense-115, speed-95]).
pokemon_form_base(10318, 801).
pokemon_form_kind(10318, mega).
pokemon(10319, zeraora_mega, 15, 445, [electric], [], [attack-157, defense-75, hp-88, special_attack-147, special_defense-80, speed-153]).
pokemon_form_base(10319, 807).
pokemon_form_kind(10319, mega).
pokemon(10320, scovillain_mega, 12, 220, [grass, fire], [spicy_spray], [attack-138, defense-85, hp-65, special_attack-138, special_defense-85, speed-75]).
pokemon_form_base(10320, 952).
pokemon_form_kind(10320, mega).
pokemon(10321, glimmora_mega, 28, 770, [rock, poison], [adaptability], [attack-90, defense-105, hp-83, special_attack-150, special_defense-96, speed-101]).
pokemon_form_base(10321, 970).
pokemon_form_kind(10321, mega).
pokemon(10322, tatsugiri_curly_mega, 6, 240, [dragon, water], [], [attack-65, defense-90, hp-68, special_attack-135, special_defense-125, speed-92]).
pokemon_form_base(10322, 978).
pokemon_form_kind(10322, mega).
pokemon(10323, tatsugiri_droopy_mega, 6, 240, [dragon, water], [], [attack-65, defense-90, hp-68, special_attack-135, special_defense-125, speed-92]).
pokemon_form_base(10323, 978).
pokemon_form_kind(10323, mega).
pokemon(10324, tatsugiri_stretchy_mega, 6, 240, [dragon, water], [], [attack-65, defense-90, hp-68, special_attack-135, special_defense-125, speed-92]).
pokemon_form_base(10324, 978).
pokemon_form_kind(10324, mega).
pokemon(10325, baxcalibur_mega, 21, 3150, [dragon, ice], [], [attack-175, defense-117, hp-115, special_attack-105, special_defense-101, speed-87]).
pokemon_form_base(10325, 998).
pokemon_form_kind(10325, mega).
