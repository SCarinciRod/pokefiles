param(
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
    Write-Host "[validate] $Message" -ForegroundColor Cyan
}

function Assert-Command([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        throw "Comando '$Name' nao encontrado no PATH."
    }
}

function Invoke-Prolog([string]$Goal) {
    & swipl -q -s .\pokedex_bot.pl -g $Goal
    if ($LASTEXITCODE -ne 0) {
        throw "Falha executando objetivo Prolog: $Goal"
    }
}

Assert-Command 'swipl'

Push-Location (Join-Path $PSScriptRoot '..')
try {
    Write-Step 'Validando parse de todos os arquivos .pl da pasta db...'
    $failed = @()
    Get-ChildItem .\db -Filter *.pl | ForEach-Object {
        $path = $_.FullName -replace '\\', '/'
        swipl -q -g "catch(consult('$path'),E,(print_message(error,E),halt(1))),halt." 2>$null
        if ($LASTEXITCODE -ne 0) {
            $failed += $_.Name
        }
    }

    if ($failed.Count -gt 0) {
        throw "Arquivos com erro de parse: $($failed -join ', ')"
    }

    Write-Step 'Medindo tempo de carga da base...'
    Invoke-Prolog "statistics(cputime,T0),load_database,set_default_generation,statistics(cputime,T1),DT is T1-T0,format('LOAD_CPU_SEC=~3f~n',[DT]),halt."

    Write-Step 'Executando consultas baseline para inferencias...'
    Invoke-Prolog "load_database,set_default_generation,statistics(inferences,I0),type_pokemon_count(fire,C1),statistics(inferences,I1),D1 is I1-I0,format('BASE_FIRE_COUNT=~w INF=~w~n',[C1,D1]),statistics(inferences,I2),ability_pokemon_list(blaze,L),length(L,C2),statistics(inferences,I3),D2 is I3-I2,format('BASE_BLAZE_COUNT=~w INF=~w~n',[C2,D2]),halt."

    Write-Step 'Comparando inferencias (primeira vs segunda chamada) para validar cache...'
    Invoke-Prolog "load_database,set_default_generation,statistics(inferences,T0),type_pokemon_count(fire,_),statistics(inferences,T1),type_pokemon_count(fire,_),statistics(inferences,T2),DTypeFirst is T1-T0,DTypeSecond is T2-T1,format('CACHE_TYPE_COUNT first=~w second=~w~n',[DTypeFirst,DTypeSecond]),statistics(inferences,L0),type_pokemon_list([fire],_),statistics(inferences,L1),type_pokemon_list([fire],_),statistics(inferences,L2),DListFirst is L1-L0,DListSecond is L2-L1,format('CACHE_TYPE_LIST first=~w second=~w~n',[DListFirst,DListSecond]),statistics(inferences,A0),ability_pokemon_list(blaze,_),statistics(inferences,A1),ability_pokemon_list(blaze,_),statistics(inferences,A2),DAbilityFirst is A1-A0,DAbilitySecond is A2-A1,format('CACHE_ABILITY_LIST first=~w second=~w~n',[DAbilityFirst,DAbilitySecond]),statistics(inferences,M0),move_catalog(Moves),length(Moves,_),statistics(inferences,M1),move_catalog(Moves2),length(Moves2,_),statistics(inferences,M2),DMoveFirst is M1-M0,DMoveSecond is M2-M1,format('CACHE_MOVE_CATALOG first=~w second=~w~n',[DMoveFirst,DMoveSecond]),halt."

    if (-not $SkipTests) {
        Write-Step 'Rodando suite de regressao da engine...'
        swipl -q -s .\tests\engine_regression_tests.pl -g "run_tests([engine_regression]),halt."
        if ($LASTEXITCODE -ne 0) {
            throw 'Falha na suite de testes engine_regression.'
        }

        Write-Step 'Rodando suite de NLP/heuristica...'
        swipl -q -s .\tests\nlp_token_heuristics_tests.pl -g "run_tests([nlp_token_heuristics]),halt."
        if ($LASTEXITCODE -ne 0) {
            throw 'Falha na suite de testes nlp_token_heuristics.'
        }
    }

    Write-Step 'Validacao e benchmark concluidos com sucesso.'
}
finally {
    Pop-Location
}
