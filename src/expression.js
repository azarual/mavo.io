(function($, $$) {

var _ = Mavo.Expression = $.Class({
	constructor: function(expression) {
		this.expression = expression;
	},

	eval: function(data) {
		this.oldValue = this.value;

		// TODO convert to new Function() which is more optimizable by JS engines.
		// Also, cache the function, since only data changes across invocations.
		Mavo.hooks.run("expression-eval-beforeeval", this);

		try {
			if (!this.function) {
				this.function = this.createFunction();
			}

			this.value = this.function(data);
		}
		catch (exception) {
			Mavo.hooks.run("expression-eval-error", {context: this, exception});

			this.value = _.ERROR;
		}

		return this.value;
	},

	toString() {
		return `[${this.expression}]`;
	},

	createFunction: function() {
		var code = this.expression;

		if (/^if\([\S\s]+\)$/i.test(code)) {
			code = code.replace(/^if\(/, "iff(");
		}

		// Transform simple operators to array-friendly math functions
		code = code.replace(_.simpleOperation, (expr, operand1, operator, operand2) => {
			var ret = `(${Mavo.Functions.operators[operator]}(${operand1}, ${operand2}))`;
			return ret;
		});

		_.simpleOperation.lastIndex = 0;

		return new Function("data", `with(Mavo.Functions._Trap)
				with(data) {
					return ${code};
				}`);
	},

	live: {
		expression: function(value) {
			var code = value = value.trim();

			this.function = null;
		}
	},

	static: {
		ERROR: "N/A",

		lazy: {
			simpleOperation: function() {
				var operator = Object.keys(Mavo.Functions.operators).map(o => o.replace(/[|*+]/g, "\\$&")).join("|");
				var operand = "\\s*(\\b[\\w.]+\\b)\\s*";

				return RegExp(`(?:^|\\()${operand}(${operator})${operand}(?:$|\\))`, "g");
			}
		}
	}
});

(function() {

var _ = Mavo.Expression.Text = $.Class({
	constructor: function(o) {
		this.all = o.all; // the Mavo.Expressions object that this belongs to
		this.node = o.node;
		this.path = o.path;

		if (!this.node) {
			// No node provided, figure it out from path
			this.node = this.path.reduce((node, index) => {
				return node.childNodes[index];
			}, this.all.scope.element);
		}

		this.element = this.node;

		this.attribute = o.attribute || null;

		if (this.node.nodeType === 3) {
			this.element = this.node.parentNode;

			// If no element siblings make this.node the element, which is more robust
			// Same if attribute, there are no attributes on a text node!
			if (!this.node.parentNode.children.length || this.attribute) {
				this.node = this.element;
				this.element.normalize();
			}
		}

		this.expression = (this.attribute? this.node.getAttribute(this.attribute) : this.node.textContent).trim();
		this.template = o.template? o.template.template : this.tokenize(this.expression);

		// Is this a computed property?
		var primitive = Mavo.Unit.get(this.element);
		if (primitive && this.attribute === primitive.attribute) {
			this.primitive = primitive;
			primitive.computed = true; // Primitives containing an expression as their value are implicitly computed
		}

		Mavo.hooks.run("expressiontext-init-end", this);

		_.elements.set(this.element, [...(_.elements.get(this.element) || []), this]);
	},

	update: function(data) {
		this.data = data;

		var ret = {};

		ret.value = this.value = this.template.map(expr => {
			if (expr instanceof Mavo.Expression) {
				var env = {context: this, expr};

				Mavo.hooks.run("expressiontext-update-beforeeval", env);

				env.value = env.expr.eval(data);

				Mavo.hooks.run("expressiontext-update-aftereval", env);

				if (env.value === undefined || env.value === null) {
					// Don’t print things like "undefined" or "null"
					return "";
				}

				return env.value;
			}

			return expr;
		});

		if (!this.attribute) {
			// Separate presentational & actual values only apply when content is variable
			ret.presentational = this.value.map(value => {
				if (Array.isArray(value)) {
					return value.join(", ");
				}

				if (typeof value == "number") {
					return Mavo.Primitive.formatNumber(value);
				}

				return value;
			});

			ret.presentational = ret.presentational.length === 1? ret.presentational[0] : ret.presentational.join("");
		}

		ret.value = ret.value.length === 1? ret.value[0] : ret.value.join("");

		if (this.primitive && this.template.length === 1) {
			if (typeof ret.value === "number") {
				this.primitive.datatype = "number";
			}
			else if (typeof ret.value === "boolean") {
				this.primitive.datatype = "boolean";
			}
		}

		if (ret.presentational === ret.value) {
			ret = ret.value;
		}

		if (this.primitive) {
			this.primitive.value = ret;
		}
		else {
			Mavo.Primitive.setValue(this.node, ret, this.attribute, {presentational: ret.presentational});
		}
	},

	tokenize: function(template) {
		var regex = this.expressionRegex;
		var match, ret = [], lastIndex = 0;

		regex.lastIndex = 0;

		while ((match = regex.exec(template)) !== null) {
			// Literal before the expression
			if (match.index > lastIndex) {
				ret.push(template.substring(lastIndex, match.index));
			}

			lastIndex = regex.lastIndex = _.findEnd(template.slice(match.index)) + match.index + 1;
			var expression = template.slice(match.index + 1, lastIndex - 1);

			ret.push(new Mavo.Expression(expression));
		}

		// Literal at the end
		if (lastIndex < template.length) {
			ret.push(template.substring(lastIndex));
		}

		return ret;
	},

	proxy: {
		scope: "all",
		expressionRegex: "all"
	},

	static: {
		elements: new WeakMap(),

		// Find where a ( or [ or { ends.
		findEnd: function(expr) {
			var stack = [];
			var inside, insides = "\"'`";
			var open = "([{", close = ")]}";
			var isEscape;

			for (var i=0; expr[i]; i++) {
				var char = expr[i];

				if (inside) {
					if (char === inside && !isEscape) {
						inside = "";
					}
				}
				else if (!isEscape && insides.indexOf(char) > -1) {
					inside = char;
				}
				else if (open.indexOf(char) > -1) {
					stack.push(char);
				}
				else {
					var peek = stack[stack.length - 1];

					if (char === close[open.indexOf(peek)]) {
						stack.pop();
					}

					if (stack.length === 0) {
						break;
					}
				}

				isEscape = char == "\\";
			}

			return i;
		},

		lazy: {
			rootFunctionRegExp: () => RegExp("^=\\s*(?:" + Mavo.Expressions.rootFunctions.join("|") + ")\\($", "i")
		}
	}
});

})();

(function() {

var _ = Mavo.Expressions = $.Class({
	constructor: function(scope) {
		if (scope) {
			this.scope = scope;
			this.scope.expressions = this;
		}

		this.all = []; // all Expression.Text objects in this scope

		Mavo.hooks.run("expressions-init-start", this);

		if (this.scope) {
			var template = this.scope.template;

			if (template && template.expressions) {
				// We know which expressions we have, don't traverse again
				template.expressions.all.forEach(et => {
					this.all.push(new Mavo.Expression.Text({
						path: et.path,
						attribute: et.attribute,
						all: this,
						template: et
					}));
				});
			}
			else {
				this.traverse();
			}
		}

		// TODO less stupid name?
		this.updateAlso = new Set();

		this.active = true;

		if (this.all.length > 0) {
			this.update();

			// Watch changes and update value
			this.scope.element.addEventListener("mavo:datachange", evt => this.update());
		}
	},

	/**
	 * Update all expressions in this scope
	 */
	update: function callee() {
		if (!this.active || this.scope.isDeleted()) {
			return;
		}

		var env = { context: this, data: this.scope.getRelativeData() };

		Mavo.hooks.run("expressions-update-start", env);

		$$(this.all).forEach(ref => {
			ref.update(env.data);
		});

		this.updateAlso.forEach(exp => exp.update());
	},

	extract: function(node, attribute, path) {
		this.expressionRegex.lastIndex = 0;

		if (this.expressionRegex.test(attribute? attribute.value : node.textContent)) {
			this.all.push(new Mavo.Expression.Text({
				node,
				path: (path || "").slice(1).split("/").map(i => +i),
				attribute: attribute && attribute.name,
				all: this
			}));
		}
	},

	// Traverse an element, including attribute nodes, text nodes and all descendants
	traverse: function(node, path) {
		node = node || this.scope.element;
		path = path || "";

		if (node.matches && node.matches(_.escape)) {
			return;
		}

		if (node.nodeType === 3) { // Text node
			// Leaf node, extract references from content
			this.extract(node, null, path);
		}

		// Traverse children and attributes as long as this is NOT the root of a child scope
		// (otherwise, it will be taken care of its own Expressions object)
		if (node == this.scope.element || !Mavo.is("scope", node)) {
			$$(node.attributes).forEach(attribute => this.extract(node, attribute, path));
			$$(node.childNodes).forEach((child, i) => this.traverse(child, `${path}/${i}`));
		}
	},

	lazy: {
		// Regex that loosely matches all possible expressions
		// False positives are ok, but false negatives are not.
		expressionRegex: function() {
			var properties = this.scope.mavo.propertyNames.concat(_.special);
			var propertyRegex = "(?:" + properties.join("|").replace(/\$/g, "\\$") + ")";

			return RegExp(`\\[[\\S\\s]*?${propertyRegex}[\\S\\s]*?\\]`, "gi");
		}
	},

	static: {
		escape: ".ignore-expressions",

		// Special property names
		special: ["$index"],

		lazy: {
			rootFunctions: () => [
				...Object.keys(Mavo.Functions),
				...Object.getOwnPropertyNames(Math),
				"if", ""
			]
		}
	}
});

})();

Mavo.hooks.add("init-tree-after", function() {
	this.walk(obj => {
		if (obj instanceof Mavo.Scope) {
			new Mavo.Expressions(obj);
		}
	});
});

Mavo.hooks.add("scope-init-end", function() {
	requestAnimationFrame(() => {
		// Tree expressions are processed synchronously, so by now if it doesn't have
		// an expressions object, we need to create it.
		if (!this.expressions) {
			new Mavo.Expressions(this);
		}

		this.expressions.update();
	});
});

Mavo.hooks.add("scope-render-start", function() {
	if (!this.expressions) {
		// ??? How can it not have expressions by now?!
		new Mavo.Expressions(this);
	}

	this.expressions.active = false;
});

Mavo.hooks.add("scope-render-end", function() {
	requestAnimationFrame(() => {
		this.expressions.active = true;
		this.expressions.update();
	});
});

})(Bliss, Bliss.$);
