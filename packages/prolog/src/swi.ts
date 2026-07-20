// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: MIT

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Atom } from "@mettascript/hyperon";
import {
  atomToPrologTerm,
  prologTermToAtom,
  type PrologBridge,
  type PrologTermJson,
} from "./prolog";

export interface SwiPrologBridgeOptions {
  readonly executable?: string;
}

type Request =
  | { readonly cmd: "query"; readonly goal: PrologTermJson }
  | { readonly cmd: "asserta"; readonly term: PrologTermJson }
  | { readonly cmd: "assertz"; readonly term: PrologTermJson }
  | { readonly cmd: "retract"; readonly term: PrologTermJson }
  | { readonly cmd: "consult"; readonly path: string }
  | { readonly cmd: "arities"; readonly name: string };

type Response =
  | { readonly ok: true; readonly answers: readonly PrologTermJson[] }
  | { readonly ok: true; readonly value: boolean }
  | { readonly ok: true; readonly arities: readonly number[] }
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

const SERVER_SRC = String.raw`
:- use_module(library(http/json)).
:- initialization(main, main).

main :-
    repeat,
    read_line_to_string(user_input, Line),
    ( Line == end_of_file
    -> !
    ;  handle_line(Line),
       fail
    ).

handle_line(Line) :-
    catch(
        ( open_string(Line, Stream),
          json_read_dict(Stream, Req),
          close(Stream),
          dispatch(Req, Resp0),
          Resp = Resp0.put(id, Req.id)
        ),
        E,
        ( message_to_string(E, Msg),
          ( catch(open_string(Line, S2), _, fail),
            catch(json_read_dict(S2, BadReq), _, fail),
            catch(close(S2), _, true),
            get_dict(id, BadReq, Id)
          -> true
          ;  Id = -1
          ),
          Resp = json{id:Id, ok:false, error:Msg}
        )
    ),
    json_write_dict(current_output, Resp, [width(0)]),
    nl,
    flush_output(current_output).

dispatch(Req, json{ok:true, answers:Answers}) :-
    Req.cmd == "query",
    !,
    json_to_term(Req.goal, Goal),
    findall(Answer, (call(Goal), term_to_json(Goal, Answer)), Answers).
dispatch(Req, json{ok:true}) :-
    Req.cmd == "asserta",
    !,
    json_to_term(Req.term, Term),
    asserta(Term).
dispatch(Req, json{ok:true}) :-
    Req.cmd == "assertz",
    !,
    json_to_term(Req.term, Term),
    assertz(Term).
dispatch(Req, json{ok:true, value:Value}) :-
    Req.cmd == "retract",
    !,
    json_to_term(Req.term, Term),
    ( once(retract(Term)) -> Value = true ; Value = false ).
dispatch(Req, json{ok:true}) :-
    Req.cmd == "consult",
    !,
    consult(Req.path).
dispatch(Req, json{ok:true, arities:Arities}) :-
    Req.cmd == "arities",
    !,
    atom_string(Name, Req.name),
    findall(A, current_predicate(Name/A), Raw),
    sort(Raw, Arities).
dispatch(Req, _) :-
    throw(error(domain_error(prolog_bridge_command, Req.cmd), _)).

json_to_term(Json, Term) :-
    json_to_term(Json, Term, [], _).

json_to_term(Json, Term, Vars0, Vars) :-
    Type = Json.type,
    ( Type == "var"
    -> var_for_name(Json.name, Term, Vars0, Vars)
    ; Type == "atom"
    -> atom_string(Term, Json.name),
       Vars = Vars0
    ; Type == "int"
    -> number_string(Term, Json.value),
       Vars = Vars0
    ; Type == "float"
    -> Term = Json.value,
       Vars = Vars0
    ; Type == "string"
    -> Term = Json.value,
       Vars = Vars0
    ; Type == "compound"
    -> atom_string(Functor, Json.functor),
       json_to_terms(Json.args, Args, Vars0, Vars),
       Term =.. [Functor|Args]
    ; throw(error(domain_error(prolog_term_json, Type), _))
    ).

json_to_terms([], [], Vars, Vars).
json_to_terms([Json|Rest], [Term|Terms], Vars0, Vars) :-
    json_to_term(Json, Term, Vars0, Vars1),
    json_to_terms(Rest, Terms, Vars1, Vars).

var_for_name(Name, Var, Vars, Vars) :-
    memberchk(Name=Existing, Vars),
    !,
    Var = Existing.
var_for_name(Name, Var, Vars, [Name=Var|Vars]).

term_to_json(Term, Json) :-
    ( var(Term)
    -> Json = json{type:"var", name:"_"}
    ; integer(Term)
    -> number_string(Term, Value),
       Json = json{type:"int", value:Value}
    ; float(Term)
    -> Json = json{type:"float", value:Term}
    ; string(Term)
    -> Json = json{type:"string", value:Term}
    ; atom(Term)
    -> atom_string(Term, Name),
       Json = json{type:"atom", name:Name}
    ; Term =.. [Functor|Args],
      atom_string(Functor, FunctorString),
      terms_to_json(Args, JsonArgs),
      Json = json{type:"compound", functor:FunctorString, args:JsonArgs}
    ).

terms_to_json([], []).
terms_to_json([Term|Rest], [Json|JsonRest]) :-
    term_to_json(Term, Json),
    terms_to_json(Rest, JsonRest).
`;

interface Pending {
  readonly resolve: (value: Response) => void;
  readonly reject: (error: Error) => void;
}

export class SwiPrologBridge implements PrologBridge {
  private readonly dir: string;
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private stdout = "";
  private stderr = "";
  private disposed = false;

  constructor(opts: SwiPrologBridgeOptions = {}) {
    const executable = opts.executable ?? "swipl";
    const version = spawnSync(executable, ["--version"], { encoding: "utf8" });
    if (version.error !== undefined) {
      throw new Error(`--prolog needs SWI-Prolog on PATH (${version.error.message})`);
    }
    this.dir = mkdtempSync(join(tmpdir(), "metta-ts-prolog-"));
    const server = join(this.dir, "server.pl");
    writeFileSync(server, SERVER_SRC);
    this.proc = spawn(executable, ["-q", "-f", "none", server]);
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.handleStdout(chunk));
    this.proc.stderr.on("data", (chunk: string) => {
      this.stderr += chunk;
    });
    this.proc.on("error", (error) => this.rejectAll(error));
    this.proc.on("exit", (code, signal) => {
      if (!this.disposed) {
        this.rejectAll(
          new Error(
            `SWI-Prolog bridge exited (${signal ?? code ?? "unknown"})${this.stderrText()}`,
          ),
        );
      }
    });
  }

  async query(goal: Atom): Promise<Atom[]> {
    const response = await this.request({ cmd: "query", goal: atomToPrologTerm(goal) });
    if (!("answers" in response)) throw new Error("SWI-Prolog bridge query returned no answers");
    return response.answers.map(prologTermToAtom);
  }

  async asserta(term: Atom): Promise<void> {
    await this.request({ cmd: "asserta", term: atomToPrologTerm(term) });
  }

  async assertz(term: Atom): Promise<void> {
    await this.request({ cmd: "assertz", term: atomToPrologTerm(term) });
  }

  async retract(term: Atom): Promise<boolean> {
    const response = await this.request({ cmd: "retract", term: atomToPrologTerm(term) });
    if (!("value" in response)) throw new Error("SWI-Prolog bridge retract returned no value");
    return response.value;
  }

  async consult(path: string): Promise<void> {
    await this.request({ cmd: "consult", path });
  }

  async predicateArities(name: string): Promise<number[]> {
    const response = await this.request({ cmd: "arities", name });
    if (!("arities" in response)) throw new Error("SWI-Prolog bridge arities returned no value");
    return [...response.arities];
  }

  dispose(): void {
    this.disposed = true;
    for (const pending of this.pending.values())
      pending.reject(new Error("SWI-Prolog bridge closed"));
    this.pending.clear();
    this.proc.kill();
    rmSync(this.dir, { recursive: true, force: true });
  }

  private request(payload: Request): Promise<Extract<Response, { ok: true }>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (response) => {
          if (!response.ok) reject(new Error(response.error));
          else resolve(response);
        },
        reject,
      });
      this.proc.stdin.write(JSON.stringify({ ...payload, id }) + "\n", (error) => {
        if (error !== null && error !== undefined) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  private handleStdout(chunk: string): void {
    this.stdout += chunk;
    for (;;) {
      const index = this.stdout.indexOf("\n");
      if (index === -1) return;
      const line = this.stdout.slice(0, index).trim();
      this.stdout = this.stdout.slice(index + 1);
      if (line === "") continue;
      let parsed: Response & { readonly id?: number };
      try {
        parsed = JSON.parse(line) as Response & { readonly id?: number };
      } catch (e) {
        this.rejectAll(new Error(`SWI-Prolog bridge emitted invalid JSON: ${String(e)}`));
        continue;
      }
      const id = parsed.id;
      if (id === undefined) continue;
      const pending = this.pending.get(id);
      if (pending === undefined) continue;
      this.pending.delete(id);
      pending.resolve(parsed);
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private stderrText(): string {
    const text = this.stderr.trim();
    return text === "" ? "" : `: ${text}`;
  }
}

export function swiPrologBridge(opts: SwiPrologBridgeOptions = {}): SwiPrologBridge {
  return new SwiPrologBridge(opts);
}
