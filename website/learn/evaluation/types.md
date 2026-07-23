<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: MIT
-->

# Types

Everything so far has run without a single type declaration, and that is the point: MeTTa's typing is optional. You reach for it when you want the interpreter to catch a mistake for you, not because the language forces it. Let us start by asking what type something already has, then add our own.

## Every value already has a type

`get-type` answers "what is the type of this atom?". Grounded literals carry a built-in type:

<MettaRunner>

```metta
!(get-type 5)      ; Number
!(get-type "hi")   ; String
!(get-type True)   ; Bool
```

</MettaRunner>

A plain symbol you have not said anything about has no type yet. MeTTa reports that as `%Undefined%`, which is not an error, just "unknown":

<MettaRunner>

```metta
!(get-type hello)  ; %Undefined%
```

</MettaRunner>

## Declaring a type

The colon symbol `:` declares a type. Read `(: subject type)` as "subject has type type". A type is just a symbol you choose; you do not have to define it anywhere first:

<MettaRunner>

```metta
(: Socrates Human)
!(get-type Socrates)   ; Human
```

</MettaRunner>

Once declared, `Socrates` is a `Human` everywhere in the program. Nothing else changed: `Human` is an ordinary symbol that now plays the role of a type.

## Function types

A function's type is written with the arrow symbol `->`. The last position is the result type; the ones before it are the argument types. So `(-> Number Number Number)` is "takes two Numbers, gives a Number":

<MettaRunner>

```metta
(: area (-> Number Number Number))
(= (area $w $h) (* $w $h))

!(get-type area)         ; (-> Number Number Number)
!(get-type (area 3 4))   ; Number
!(area 3 4)              ; 12
```

</MettaRunner>

Notice the difference between the last two queries. `(get-type area)` asks for the function's own type, the arrow. `(get-type (area 3 4))` asks for the type of *applying* it, which is the result type `Number`, and it answers without running the computation. The declaration and the rule are separate: `:` says what the types are, `=` says how to compute.

## Type checking catches wrong arguments

Declaring a type is worth doing because the interpreter then checks calls against it. Give a typed function the right kind of argument and it runs; give it the wrong kind and you get an error atom instead of a wrong answer:

<MettaRunner>

```metta
(: inc (-> Number Number))
(= (inc $x) (+ $x 1))

!(inc 5)     ; 6
!(inc "a")   ; (Error (inc "a") (BadArgType 1 Number String))
```

</MettaRunner>

The error reads off exactly what went wrong: argument `1` of `inc` should be a `Number`, but a `String` was passed. The check happens as the call is evaluated, so a mismatch never silently produces a bad result.

## Typed data

Types are not only for functions. A constructor is just a function whose result is a data type, so the same `->` declares it. This is the classic way to build the natural numbers as `Z` (zero) and `S` (successor):

<MettaRunner>

```metta
(: Z Nat)
(: S (-> Nat Nat))

!(get-type (S (S Z)))   ; Nat
!(S (S Z))              ; (S (S Z))
```

</MettaRunner>

`(S (S Z))` is well-typed, so it has type `Nat` and stands as its own value, there is no rule to reduce it. The type declaration also guards the constructor, exactly as it guarded `inc`:

<MettaRunner>

```metta
(: Z Nat)
(: S (-> Nat Nat))

!(S 5)   ; (Error (S 5) (BadArgType 1 Nat Number))
```

</MettaRunner>

`S` wanted a `Nat` and got a `Number`, so building `(S 5)` is a type error the same way calling `(inc "a")` was.

## Numeric type aliases

Numbers have the single type `Number`, but signatures written in other MeTTa dialects often say `Int`, `Integer`, `Double`, or `Float` instead. MeTTaScript accepts those names as aliases of `Number`, in both directions: an `Int` parameter takes any number, and an `Int`-typed result feeds a `Number` parameter such as `+`.

<MettaRunner>

```metta
(: inc (-> Int Int))
(= (inc $x) (+ $x 1))

!(inc 5)    ; 6
!(inc 2.5)  ; 3.5
```

</MettaRunner>

The aliases name one numeric family, not separate widths, so `(inc 2.5)` is fine. A type you define yourself, like `Nat` above, is not an alias: `(S 5)` stays a type error.

## Metatypes: the shape of an atom

The types above are ones you declare. Underneath them, every atom also has one of four fixed *metatypes* that describe its shape rather than its meaning. `get-metatype` reports it:

<MettaRunner>

```metta
!(get-metatype 5)       ; Grounded
!(get-metatype hello)   ; Symbol
!(get-metatype (S Z))   ; Expression
!(get-metatype $x)      ; Variable
```

</MettaRunner>

Every atom is exactly one of these. A grounded value such as a number or string is `Grounded`; a bare name is a `Symbol`; anything in parentheses is an `Expression`; a `$`-name is a `Variable`. Where a declared type says what an atom *means* (`Socrates` is a `Human`), a metatype says what it *is made of*, and a program can branch on that to reason about atoms themselves.

## Types stay optional

None of this is required. Untyped code runs exactly as it did in the earlier pages:

<MettaRunner>

```metta
(= (twice $x) (* 2 $x))
!(twice 21)   ; 42
```

</MettaRunner>

Add declarations where a mistake would be costly and let the checker guard those calls; leave them off where you just want to compute. That gradual middle, typed and untyped code living together, is what MeTTa means by optional typing.

## Next

Put the whole introduction into practice with the **[Exercises](/learn/exercises)**. When you are ready to embed the interpreter in your own code, continue to **[using MeTTa from TypeScript](/typescript/running-metta)**.
