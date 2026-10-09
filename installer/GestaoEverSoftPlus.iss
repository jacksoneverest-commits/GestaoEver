; Instalador da API do GestaoEverSoftPlus (Inno Setup 6.3+).
; Gere com installer\preparar-pacote.ps1 (monta installer\staging antes de compilar).
;
; O que faz: copia a API + node.exe embutido + node_modules, pergunta os dados do
; MariaDB/CORS/porta, grava backend\.env (com AUTH_SECRET novo), testa a conexao,
; opcionalmente cria o primeiro usuario, registra as tarefas agendadas (API na
; inicializacao do Windows e job diario de cache as 01:00), libera a porta no firewall
; e inicia a API. Numa instalacao nova, assim que a API responde em /health, dispara em segundo
; plano a carga inicial das tabelas de cache (agendarJobsDiarios.js --desde <data da pagina>).
; Migrations: aplicadas por scripts\aplicar-migrations.js se o checkbox da pagina estiver marcado
; (autorizado pelo usuario em 2026-10-09); os .sql tambem ficam em {app}\migrations.
;
; Instalacao silenciosa: /VERYSILENT /DBHOST=.. /DBUSER=.. /DBPASSWORD=.. /DBNAME=..
;   /PORTA=3001 /CORS=https://app.vercel.app [/ADMINUSER=.. /ADMINNOME=.. /ADMINPERFIL=dono /ADMINSENHA=..] [/MIGRATIONS=0 para nao aplicar migrations] [/DESDE=2025-01-01 data inicial da carga; /DESDE= vazio = so os ultimos 30 dias]

#ifndef Versao
  #define Versao "1.0.0"
#endif

[Setup]
AppId={{7C1B7B52-5E0F-4D43-9A1E-3A6E2C0B9F11}
AppName=GestaoEverSoftPlus API
AppVersion={#Versao}
AppPublisher=GestaoEverSoftPlus
DefaultDirName={autopf}\GestaoEverSoftPlus
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=Output
OutputBaseFilename=GestaoEverSoftPlus-API-Setup-{#Versao}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=GestaoEverSoftPlus API

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "staging\node\node.exe"; DestDir: "{app}\node"; Flags: ignoreversion
Source: "staging\backend\*"; DestDir: "{app}\backend"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\backend\src\db\migrations\*.sql"; DestDir: "{app}\migrations"; Flags: ignoreversion
; .env e estado-jobs\ NAO estao aqui: nunca sao sobrescritos numa atualizacao.

[Dirs]
Name: "{app}\backend\estado-jobs"

[Code]
const
  TarefaApi = 'GestaoEverSoftPlus - Backend';
  TarefaJob = 'GestaoEverSoftPlus - Cache diario';
  RegraFirewall = 'GestaoEverSoftPlus API';

var
  PaginaBanco, PaginaApi, PaginaUsuario, PaginaCarga: TInputQueryWizardPage;
  PaginaMigrations: TInputOptionWizardPage;
  CargaInicialPendente: Boolean;
  CargaDesde: String;

function SetEnvironmentVariable(lpName, lpValue: String): Boolean;
  external 'SetEnvironmentVariableW@kernel32.dll stdcall';

function Aspas(const S: String): String;
begin
  Result := '"' + S + '"';
end;

function NodeExe: String;
begin
  Result := ExpandConstant('{app}\node\node.exe');
end;

function BackendDir: String;
begin
  Result := ExpandConstant('{app}\backend');
end;

function RodarNode(const Args: String; out Codigo: Integer): Boolean;
begin
  Result := Exec(NodeExe, Args, BackendDir, SW_HIDE, ewWaitUntilTerminated, Codigo);
end;

function RodarCmd(const Programa, Args: String): Integer;
var
  Codigo: Integer;
begin
  if not Exec(Programa, Args, '', SW_HIDE, ewWaitUntilTerminated, Codigo) then
    Codigo := -1;
  Result := Codigo;
end;

{ Valor seguro para o dotenv (senhas costumam ter #, espaco ou aspas). }
function ValorEnv(const V: String): String;
var
  Perigoso: Boolean;
begin
  Perigoso := (Pos('#', V) > 0) or (Pos(' ', V) > 0) or (Pos('''', V) > 0)
    or (Pos('"', V) > 0) or (Pos('\', V) > 0) or (Pos('`', V) > 0);
  Result := V;
  if not Perigoso then Exit;
  if Pos('''', V) = 0 then Result := '''' + V + ''''
  else if Pos('"', V) = 0 then Result := '"' + V + '"'
  else if Pos('`', V) = 0 then Result := '`' + V + '`'
  else RaiseException('A senha mistura aspas simples, duplas e crase. Use outra senha para o usuario do banco.');
end;

procedure InitializeWizard;
begin
  PaginaBanco := CreateInputQueryPage(wpSelectDir, 'Banco de dados',
    'Conexao com o MariaDB do cliente',
    'Informe o usuario dedicado da aplicacao (nao o root do ERP).');
  PaginaBanco.Add('Servidor (DB_HOST):', False);
  PaginaBanco.Add('Usuario (DB_USER):', False);
  PaginaBanco.Add('Senha (DB_PASSWORD):', True);
  PaginaBanco.Add('Banco (DB_NAME):', False);
  PaginaBanco.Values[0] := ExpandConstant('{param:DBHOST|localhost}');
  PaginaBanco.Values[1] := ExpandConstant('{param:DBUSER|}');
  PaginaBanco.Values[2] := ExpandConstant('{param:DBPASSWORD|}');
  PaginaBanco.Values[3] := ExpandConstant('{param:DBNAME|}');

  PaginaApi := CreateInputQueryPage(PaginaBanco.ID, 'Servidor da API',
    'Porta e acesso do frontend',
    'CORS: origem exata do frontend na Vercel (ex: https://seuapp.vercel.app). Varias origens separadas por virgula.');
  PaginaApi.Add('Porta da API:', False);
  PaginaApi.Add('Origem(ns) permitida(s) (CORS_ORIGINS):', False);
  PaginaApi.Values[0] := ExpandConstant('{param:PORTA|3001}');
  PaginaApi.Values[1] := ExpandConstant('{param:CORS|}');

  PaginaMigrations := CreateInputOptionPage(PaginaApi.ID, 'Banco de dados',
    'Migrations (tabelas da aplicacao)',
    'Cria/atualiza as tabelas proprias do GestaoEverSoftPlus (cache de vendas, usuarios). Nao altera tabelas do ERP. ' +
    'O usuario do banco precisa de permissao CREATE e ALTER. Cada migration e registrada e nunca reaplicada.',
    False, False);
  PaginaMigrations.Add('Aplicar as migrations pendentes agora');
  PaginaMigrations.Values[0] := ExpandConstant('{param:MIGRATIONS|1}') <> '0';

  PaginaUsuario := CreateInputQueryPage(PaginaMigrations.ID, 'Primeiro usuario',
    'Usuario de acesso ao dashboard (opcional)',
    'Requer a tabela de usuarios (migration 002). Deixe o login em branco para pular e crie depois.');
  PaginaUsuario.Add('Login:', False);
  PaginaUsuario.Add('Nome de exibicao:', False);
  PaginaUsuario.Add('Perfil (dono, gestor ou gerente_loja):', False);
  PaginaUsuario.Add('Senha (minimo 8 caracteres):', True);
  PaginaUsuario.Values[0] := ExpandConstant('{param:ADMINUSER|}');
  PaginaUsuario.Values[1] := ExpandConstant('{param:ADMINNOME|}');
  PaginaUsuario.Values[2] := ExpandConstant('{param:ADMINPERFIL|dono}');
  PaginaUsuario.Values[3] := ExpandConstant('{param:ADMINSENHA|}');

  PaginaCarga := CreateInputQueryPage(PaginaUsuario.ID, 'Carga inicial dos dados',
    'Preenchimento das tabelas da aplicacao',
    'Assim que a API estiver no ar, as tabelas de cache (vendas por dia e por produto) sao preenchidas em segundo plano, ' +
    'a partir da data abaixo. Quanto mais antiga a data, mais demora. Deixe em branco para carregar so os ultimos 30 dias. ' +
    'Depois disso o job das 01:00 e o botao "Atualizar dados" do dashboard mantem tudo em dia.');
  PaginaCarga.Add('Data inicial (AAAA-MM-DD):', False);
  PaginaCarga.Values[0] := ExpandConstant('{param:DESDE|2025-01-01}');
end;

{ AAAA-MM-DD (so digitos e hifens nas posicoes certas); o valor vai para a linha de comando do node. }
function DataIsoValida(const S: String): Boolean;
var
  I: Integer;
begin
  Result := Length(S) = 10;
  if not Result then Exit;
  for I := 1 to 10 do
    if (I = 5) or (I = 8) then
    begin
      if S[I] <> '-' then Result := False;
    end
    else if (S[I] < '0') or (S[I] > '9') then
      Result := False;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  { Atualizacao: ja existe .env, nao pergunta nada de novo. }
  Result := False;
  if (PageID = PaginaBanco.ID) or (PageID = PaginaApi.ID) or (PageID = PaginaMigrations.ID) or (PageID = PaginaUsuario.ID)
     or (PageID = PaginaCarga.ID) then
    Result := FileExists(ExpandConstant('{app}\backend\.env'));
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Porta, I: Integer;
  Perfil: String;
begin
  Result := True;
  if CurPageID = PaginaBanco.ID then
  begin
    for I := 0 to 3 do
      if Trim(PaginaBanco.Values[I]) = '' then
      begin
        MsgBox('Preencha todos os campos de conexao com o banco.', mbError, MB_OK);
        Result := False;
        Exit;
      end;
  end
  else if CurPageID = PaginaApi.ID then
  begin
    Porta := StrToIntDef(Trim(PaginaApi.Values[0]), 0);
    if (Porta < 1) or (Porta > 65535) then
    begin
      MsgBox('Porta invalida (1 a 65535).', mbError, MB_OK);
      Result := False;
    end
    else if Pos('://', PaginaApi.Values[1]) = 0 then
    begin
      MsgBox('Informe a origem do frontend com protocolo, ex: https://seuapp.vercel.app', mbError, MB_OK);
      Result := False;
    end;
  end
  else if CurPageID = PaginaCarga.ID then
  begin
    if (Trim(PaginaCarga.Values[0]) <> '') and not DataIsoValida(Trim(PaginaCarga.Values[0])) then
    begin
      MsgBox('Informe a data no formato AAAA-MM-DD (ex: 2025-01-01) ou deixe em branco.', mbError, MB_OK);
      Result := False;
    end;
  end
  else if CurPageID = PaginaUsuario.ID then
  begin
    if Trim(PaginaUsuario.Values[0]) <> '' then
    begin
      Perfil := Trim(PaginaUsuario.Values[2]);
      if (Perfil <> 'dono') and (Perfil <> 'gestor') and (Perfil <> 'gerente_loja') then
      begin
        MsgBox('Perfil deve ser dono, gestor ou gerente_loja.', mbError, MB_OK);
        Result := False;
      end
      else if Length(PaginaUsuario.Values[3]) < 8 then
      begin
        MsgBox('A senha deve ter pelo menos 8 caracteres.', mbError, MB_OK);
        Result := False;
      end;
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  { Atualizacao: para a API antes de trocar os arquivos. }
  RodarCmd('schtasks.exe', '/end /tn ' + Aspas(TarefaApi));
  Result := '';
end;

function GravarEnv: Boolean;
var
  Tmp, Segredo, Conteudo: String;
  Codigo: Integer;
  Segredo8: AnsiString;
begin
  Result := False;
  Tmp := ExpandConstant('{tmp}\segredo.txt');
  if not RodarNode('scripts\gerar-segredo.js ' + Aspas(Tmp), Codigo) or (Codigo <> 0) or
     not LoadStringFromFile(Tmp, Segredo8) then
  begin
    MsgBox('Nao foi possivel gerar o AUTH_SECRET.', mbError, MB_OK);
    Exit;
  end;
  Segredo := Trim(String(Segredo8));
  DeleteFile(Tmp);

  Conteudo :=
    'PORT=' + Trim(PaginaApi.Values[0]) + #13#10 +
    'DB_HOST=' + Trim(PaginaBanco.Values[0]) + #13#10 +
    'DB_USER=' + Trim(PaginaBanco.Values[1]) + #13#10 +
    'DB_PASSWORD=' + ValorEnv(PaginaBanco.Values[2]) + #13#10 +
    'DB_NAME=' + Trim(PaginaBanco.Values[3]) + #13#10 +
    'AUTH_SECRET=' + Segredo + #13#10 +
    'CORS_ORIGINS=' + Trim(PaginaApi.Values[1]) + #13#10;
  { Sem BOM (o BOM quebraria a primeira chave do .env). }
  Result := SaveStringToFile(BackendDir + '\.env', AnsiString(Conteudo), False);
  { Segredos: so SYSTEM e Administradores leem o .env. }
  RodarCmd('icacls.exe', Aspas(BackendDir + '\.env') + ' /inheritance:r /grant:r *S-1-5-18:F *S-1-5-32-544:F');
end;

procedure CriarUsuario;
var
  Codigo: Integer;
begin
  if Trim(PaginaUsuario.Values[0]) = '' then Exit;
  SetEnvironmentVariable('NOVA_SENHA', PaginaUsuario.Values[3]);
  if not RodarNode('src\db\scripts\criar-usuario.js ' + Aspas(Trim(PaginaUsuario.Values[0])) + ' ' +
      Aspas(Trim(PaginaUsuario.Values[1])) + ' ' + Trim(PaginaUsuario.Values[2]), Codigo) or (Codigo <> 0) then
    MsgBox('Nao foi possivel criar o usuario (a migration 002 ja foi aplicada? o login ja existe?).' + #13#10 +
      'Depois de aplicar as migrations, crie com:' + #13#10 +
      'cd ' + BackendDir + #13#10 +
      'set NOVA_SENHA=suasenha' + #13#10 +
      '..\node\node.exe src\db\scripts\criar-usuario.js login "Nome" perfil', mbInformation, MB_OK);
  SetEnvironmentVariable('NOVA_SENHA', '');
end;

procedure CriarTarefas;
var
  Wrapper: String;
begin
  Wrapper := BackendDir + '\scripts\iniciar-backend.cmd';
  RodarCmd('schtasks.exe', '/create /tn ' + Aspas(TarefaApi) + ' /tr "\"' + Wrapper + '\" \"' + NodeExe + '\"" ' +
    '/sc onstart /ru SYSTEM /rl highest /f');
  RodarCmd('schtasks.exe', '/create /tn ' + Aspas(TarefaJob) + ' /tr "\"' + NodeExe + '\" \"' +
    BackendDir + '\src\jobs\agendarJobsDiarios.js\"" /sc daily /st 01:00 /ru SYSTEM /rl highest /f');
end;

procedure LiberarFirewall(const Porta: String);
begin
  RodarCmd('netsh.exe', 'advfirewall firewall delete rule name=' + Aspas(RegraFirewall));
  RodarCmd('netsh.exe', 'advfirewall firewall add rule name=' + Aspas(RegraFirewall) +
    ' dir=in action=allow protocol=TCP localport=' + Porta + ' profile=domain,private');
end;

function LerPortaDoEnv: String;
var
  Linhas: TArrayOfString;
  I: Integer;
begin
  Result := '3001';
  if LoadStringsFromFile(BackendDir + '\.env', Linhas) then
    for I := 0 to GetArrayLength(Linhas) - 1 do
      if Pos('PORT=', Linhas[I]) = 1 then
        Result := Trim(Copy(Linhas[I], 6, Length(Linhas[I])));
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Codigo: Integer;
  MigrationsOk: Boolean;
begin
  if CurStep <> ssPostInstall then Exit;
  MigrationsOk := True;

  if not FileExists(BackendDir + '\.env') then
  begin
    WizardForm.StatusLabel.Caption := 'Gravando configuracao...';
    if not GravarEnv then Exit;
    WizardForm.StatusLabel.Caption := 'Testando conexao com o banco...';
    if not RodarNode('scripts\testar-conexao.js', Codigo) or (Codigo <> 0) then
      MsgBox('Nao foi possivel conectar ao banco com os dados informados.' + #13#10 +
        'Corrija ' + BackendDir + '\.env (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME) e reinicie a tarefa "' +
        TarefaApi + '".', mbError, MB_OK)
    else
    begin
      if PaginaMigrations.Values[0] then
      begin
        WizardForm.StatusLabel.Caption := 'Aplicando migrations...';
        if not RodarNode('scripts\aplicar-migrations.js ' + Aspas(ExpandConstant('{app}\migrations')), Codigo) or (Codigo <> 0) then
        begin
          MigrationsOk := False;
          MsgBox('Falha ao aplicar as migrations (o usuario do banco tem CREATE/ALTER?). A criacao do usuario de login foi pulada.' + #13#10 +
            'Corrija e rode: ' + NodeExe + ' ' + BackendDir + '\scripts\aplicar-migrations.js ' + ExpandConstant('{app}\migrations'), mbError, MB_OK);
        end;
      end;
      if MigrationsOk then
      begin
        WizardForm.StatusLabel.Caption := 'Criando usuario...';
        CriarUsuario;
      end;
      { Carga inicial so numa instalacao nova, com banco acessivel e migrations sem falha. }
      CargaInicialPendente := MigrationsOk;
    end;
  end;

  WizardForm.StatusLabel.Caption := 'Registrando tarefas agendadas e firewall...';
  CriarTarefas;
  LiberarFirewall(LerPortaDoEnv);
  WizardForm.StatusLabel.Caption := 'Iniciando a API...';
  RodarCmd('schtasks.exe', '/run /tn ' + Aspas(TarefaApi));

  if CargaInicialPendente then
  begin
    WizardForm.StatusLabel.Caption := 'Aguardando a API para iniciar a carga dos dados...';
    if not RodarNode('scripts\aguardar-api.js ' + LerPortaDoEnv + ' 60', Codigo) or (Codigo <> 0) then
      MsgBox('A API nao respondeu em 60 segundos; a carga inicial dos dados nao foi iniciada.' + #13#10 +
        'Depois que a API estiver no ar, use o botao "Atualizar dados" do dashboard ou rode:' + #13#10 +
        NodeExe + ' ' + BackendDir + '\src\jobs\agendarJobsDiarios.js --desde 2025-01-01', mbInformation, MB_OK)
    else
    begin
      CargaDesde := Trim(PaginaCarga.Values[0]);
      if CargaDesde <> '' then CargaDesde := ' --desde ' + CargaDesde;
      { Segundo plano: o instalador termina sem esperar; o andamento fica em estado-jobs\jobs-diarios.log. }
      if not Exec(NodeExe, 'src\jobs\agendarJobsDiarios.js' + CargaDesde, BackendDir, SW_HIDE, ewNoWait, Codigo) then
        MsgBox('Nao foi possivel iniciar a carga inicial dos dados. Use o botao "Atualizar dados" do dashboard.', mbInformation, MB_OK);
    end;
  end;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo,
  MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := MemoDirInfo + NewLine + NewLine +
    'Sera feito: gravar backend\.env, registrar a API (inicia com o Windows) e o job diario de cache (01:00), ' +
    'liberar a porta no firewall (redes Dominio/Privado) e iniciar a API. Numa instalacao nova, assim que a API responder, ' +
    'a carga inicial das tabelas de cache roda em segundo plano.' + NewLine + NewLine +
    'Se marcado na pagina de migrations, as pendentes (001 a 004) serao aplicadas no banco informado.';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    RodarCmd('schtasks.exe', '/end /tn ' + Aspas(TarefaApi));
    RodarCmd('schtasks.exe', '/delete /tn ' + Aspas(TarefaApi) + ' /f');
    RodarCmd('schtasks.exe', '/delete /tn ' + Aspas(TarefaJob) + ' /f');
    RodarCmd('netsh.exe', 'advfirewall firewall delete rule name=' + Aspas(RegraFirewall));
  end;
end;
